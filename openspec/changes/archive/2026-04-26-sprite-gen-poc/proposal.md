## Why

ローカル環境で、透過PNG 1枚と自然言語のプロンプトから、人手アノテーションを介在させながら魚スプライトのアニメーションを生成できるかを検証する PoC を立ち上げる。SaaS 化や全自動部位推定は射程外で、まずは「自然言語 → LLM が必要部位とアニメ種別を構造化出力 → 人間がマスク → LLM が renderer 設定を組み立て → ローカルで GIF とスプライトシートを出力」という一連のフローが local-first で成立することを示す。

検証対象は次の 3 点に絞る:

- 自然言語から、必要な部位ラベルとアニメーション種別を LLM が安定して構造化出力できるか
- 人間によるマスクアノテーションを前提とした場合に、固定テンプレート型 renderer でスプライト生成が成立するか
- LLM がレンダラへ渡す生成設定（または薄い glue コード）を組み立てる方式が実用になるか

Source: issue [#1 — 初期案](https://github.com/skr19930617/sprite-gen/issues/1)

## What Changes

- ローカルサーバー + ローカル UI で完結する PoC アプリケーションを新規構築する。
- 実装スタック:
  - **ローカルサーバー / Renderer**: Python (FastAPI 想定) + Pillow + numpy + imageio。
  - **ローカル UI**: React + Vite (TypeScript) を別ポートで配信し、API はサーバーにプロキシする。
  - **LLM クライアント**: Claude Code CLI を Python サーバーから subprocess として起動し、stdin で構造化プロンプト、stdout で JSON を受け取る。
- 入力面:
  - 透過 PNG のアップロードと、prompt / 出力サイズ / fps / `frame_count` / 出力形式（GIF / spritesheet / both）の UI 入力に対応する。
  - **PNG 制約**: 最大 2048×2048 px、最大 10 MB、カラーモードは RGBA のみ（RGB / グレースケールは UI 側で RGBA に変換）。`alpha >= 128` を「不透明ピクセル」と判定し、body 初期化と透明域クリップの基準にする。
  - **時間軸の規定**: `fps` と `frame_count` を主入力として必須化し、`duration_sec = frame_count / fps` を派生表示として UI に出す。`duration` 単独入力は受け付けない。`fps` は 1〜30、`frame_count` は 2〜32 を許容範囲とする。
  - **出力サイズ**: 64×64 〜 512×512 を許容、整数のみ。アスペクト比は自由。
- LLM 解析（初回）面:
  - LLM は固定スキーマで `entity_type` (=`fish` 固定), `animation_type`, `required_regions`, `optional_regions`, `params`, `annotation_schema` を返す。
  - 1 回の prompt = 1 つの `animation_type`。複数 animation を作るには、生成結果画面から「もう 1 つ作る」を押して新しい prompt を入れ、同一 source/mask の上で別 animation を追加する。
  - `animation_type` は `swim_slow` / `turn` / `approach_food` / `eat` の固定列挙のみ。
  - **PoC 必須実装は `swim_slow` と `eat` の 2 テンプレート**（受け入れ条件 §26「最低 2 種類以上」を満たし、tail と mouth の両方の検証をカバー）。`turn` と `approach_food` は時間が許せば追加だが、正式スコープからは外す。
  - 部位語彙は `body` / `tail` / `mouth` / `fin` の固定語彙のみ。
  - `params` キーと値域:
    - `speed`: enum `slow` | `medium`（デフォルト `slow`）
    - `amplitude`: enum `small` | `medium`（デフォルト `small`）
    - `emphasis`: enum `none` | `tail` | `mouth` | `fin`（デフォルトは `animation_type` 依存：`swim_slow`→`tail`, `eat`→`mouth`）
    - `loop`: bool（デフォルト `true`）
  - UI は LLM 返却後の `params` をフォームで再編集できる。`animation_type` は LLM の判定をそのまま使い、UI 上での切替は不可（再 prompt が必要）。
- マスクアノテーション UI:
  - body は source.png の `alpha >= 128` 領域全体で自動初期化し、tail / mouth / fin を人間がペン / 消しゴム / 塗りつぶし / ズーム / Undo / ラベル切替で指定する。
  - 不透明領域外への自動クリップ、小さな穴の補完、孤立ピクセル除去を補助機能として提供する。
  - **マスク永続化フォーマット**: ラベルごとに 1 枚のグレースケール PNG（`body.png` / `tail.png` / `mouth.png` / `fin.png`）。アルファ無し、白=該当ピクセル / 黒=非該当 / 任意のグレー値で確信度を表現可能（PoC では二値運用で十分）。
  - **ラベル重複ルール**: マスク同士は重複可。body は tail / mouth / fin と重なってよい（生体としてラベル領域は body の一部分でもある）。renderer はラベルの「**識別優先順位** tail > mouth > fin > body」でピクセルを分類し、各ピクセルが複数ラベルに属する場合は最も優先度の高いラベルとして処理する。UI は「derived body」（body から tail/mouth/fin を引いた残差）を任意で重ね表示できる。
- LLM 生成（2回目）面:
  - アノテーション完了後、UI は source / mask / 出力条件 / 初回 plan / `mask_labels_present` を LLM に返す。
  - LLM は **方式A: renderer に渡す生成設定 JSON**（`renderer_template` + `args`）を返す。方式 B（生成コード）は次点候補として位置づけ、PoC では採用しない。
  - `args` キーと値域（renderer 入力契約）:
    - `tail_amplitude`: float [0.0, 1.0]（tail の最大振幅、source 高さに対する比）
    - `mouth_open_ratio`: float [0.0, 1.0]（mouth の最大開度、mouth bbox 高さに対する比）
    - `body_follow`: float [0.0, 0.5]（body の連動度合い）
    - `fps`: int（UI からの値をそのまま渡す）
    - `frames`: int（= `frame_count`）
    - `output_width` / `output_height`: int
  - UI は args をフォームで再編集できる（例: tail_amplitude を調整して再レンダリング）。LLM の返却値は初期値として表示し、編集後の値をそのまま renderer に渡す。
- Renderer:
  - 固定テンプレート型。各 `animation_type` ごとに対応テンプレートを持ち、入力 source image + mask labels + config から GIF とスプライトシート PNG を出力する。
  - LLM はテンプレート選択と引数組み立てに集中し、レンダリング本体ロジックは生成しない。
  - **PoC 必須テンプレート**: `swim_slow`（tail を周期的に左右へ変形、fin は補助）と `eat`（mouth の開閉 + tail 微振動）。
  - スプライトシートは `frames` を横一列に並べる単純構成（行折り返しなし）とし、各セルサイズは `output_width × output_height`。
- 保存 / 再編集:
  - **保存先**: リポジトリ直下の `./projects/<project_id>/` ディレクトリ。`projects/` は `.gitignore` 対象で git 管理外。
  - project ディレクトリには `source.png` / `mask/<label>.png` 群 / `project.json` / `animations/<animation_id>/` (各 animation の `renderer_config.json` / `result.gif` / `spritesheet.png`) を保存する。
  - **1 project = N animations**: 同一の `source.png` と `mask/*.png` を共有しつつ、`project.json` の `animations[]` 配列に複数の `animation_type` 出力を保持する。各 animation は独自の `llm_plan` / `renderer_config` / 出力アセット参照を持つ。
  - project.json は `version=3`（issue v2 から拡張、複数 animations 対応）、`source_image_path` / `mask_dir` / `animations[]` / `created_at` / `updated_at` を含む。
  - 保存済み project の一覧表示、再読込、parameter 修正、再生成、複製保存（新しい project_id で同一 source/mask を引き継ぐ）に対応する。

非対応（明示的に範囲外）:

- SaaS / 認証 / 課金 / ジョブキュー / 非同期ワーカー / クラウド保存
- 魚以外への本格対応 / 複数個体同時処理
- 全自動部位推定 / ピクセル単位の自動セグメンテーション
- 動画入力 / 高度な物理シミュレーション / 自由形式の複雑アニメ生成
- 高機能ペイントツール化 / LLM による精密マスクの直接生成

## Capabilities

### New Capabilities

- `image-input-intake`: 透過 PNG アップロードと出力条件（サイズ / fps / フレーム数 / 出力形式）入力の受付・検証。
- `llm-plan-analysis`: 自然言語 prompt から固定スキーマの初回 LLM プランを生成する責務。`entity_type` / `animation_type` / `required_regions` / `optional_regions` / `params` / `annotation_schema` の構造化出力契約を定義する。
- `mask-annotation-ui`: 部位ラベル付きマスクの UI 編集機能。body 自動初期化、tail / mouth / fin の手動指定、ペン / 消しゴム / 塗りつぶし / Undo / ズーム / ラベル切替、補助フィルタ（透明域クリップ、穴補完、孤立ピクセル除去）。
- `llm-renderer-config`: アノテーション後の入力をもとに renderer template と引数を組み立てる責務。方式 A の `renderer_template` + `args` JSON を出力契約とする。
- `template-renderer`: 固定テンプレート型レンダラ。`swim_slow` / `turn` / `approach_food` / `eat` の各テンプレートが mask label と config を受け取り、GIF とスプライトシート PNG を出力する。
- `project-store`: ローカルフォルダ上の project 永続化と再読込。`./projects/<project_id>/` 配下に `source.png` / `mask/<label>.png` 群 / `project.json` (version=3, `animations[]` 構造) / `animations/<animation_id>/{renderer_config.json,result.gif,spritesheet.png}` を配置するレイアウト契約を定義する。
- `local-app-shell`: ローカルサーバー + UI のオーケストレーション。入力画面 / 部位指定画面 / 生成結果画面 / project 再読込画面の遷移と、UI ↔ Server ↔ LLM ↔ Renderer 間の責務分割を定義する。

### Modified Capabilities

- None identified yet.

## Impact

- 新規プロジェクトのため、すべての capability が新設。`openspec/specs/<capability>/spec.md` 群が新規生成される。
- 外部依存:
  - LLM クライアント: Claude Code CLI を Python から subprocess で起動。stdin に prompt、stdout から JSON を受け取る。`claude` バイナリは `PATH` 経由で解決し、入っていない場合は明示エラーで停止する。
  - **CLI 失敗時の振る舞い**: `non-zero exit` / `JSON 不正` / `stdout 空` / `タイムアウト (60秒)` / `認証未完了` のいずれも、自動リトライは行わず UI にエラー詳細（種別と再現用 prompt）を表示する。これまでに入力された source / 出力条件 / マスクは project に保存済みのまま維持し、ユーザーは「再試行」ボタンで同じ入力を再投入できる（新しい animation エントリは LLM 成功時のみ追加される）。
  - 画像処理: Pillow + numpy。
  - GIF / spritesheet 生成: `imageio`（GIF）と Pillow（spritesheet 合成）を優先し、独自エンコーダは書かない。
  - サーバー: FastAPI + uvicorn。
  - UI: React + Vite (TypeScript)。Canvas でマスク描画。
- 影響範囲:
  - ローカル PoC アプリケーション一式（local server + local UI + renderer + LLM 呼び出し層 + project 保存層）の新規構築。
  - 既存コードベースは現時点で本格的な実装が無いため、後方互換性の制約は無し。
- 受け入れ条件（PoC 成立判定）は issue 本文の §26 を踏襲し、追加で確定した制約を含める:
  - 2048×2048 / 10MB / RGBA 範囲内の透過 PNG をアップロードできる
  - prompt / 出力サイズ / fps / frame_count / 出力形式を入力できる
  - LLM が `animation_type` と必要部位を構造化 JSON で出力できる
  - body が `alpha >= 128` 領域で自動初期化される
  - tail / mouth / fin を UI でアノテーションできる
  - マスクが `mask/<label>.png` 群として永続化される
  - **`swim_slow` と `eat` の 2 テンプレートが GIF とスプライトシートを生成できる**
  - 同一 project に 1 prompt = 1 animation を追加でき、`project.json` v3 の `animations[]` に積み上がる
  - LLM 失敗時はエラーが UI に表示され、入力済みデータは保持される
  - project をローカル保存し再読込してから、新しい animation を追加生成できる
