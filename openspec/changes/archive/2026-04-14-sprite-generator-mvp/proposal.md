## Why

魚の透過PNG 1枚からピクセルアニメ（GIF / スプライトシート）を生成したい制作者にとって、全自動ツールは意図通りの動きを作れず、フル手作業は時間がかかる。本プロダクトは **魚特化・半自動・自然言語対応** のアプローチで「必要な部位だけ人が指定」「LLM が指示解釈とテンプレート選択を補助」「保存と再編集を最初から前提」という中間解を提供する。MVP を固定テンプレート型で小さく立ち上げ、再現性ある project データを土台に将来の拡張（他生物、共通 rig 等）へつなげる。

Source: [skr19930617/sprite-gen#1 初期案](https://github.com/skr19930617/sprite-gen/issues/1)

## What Changes

- 透過 PNG の魚キャラクター画像と自然言語プロンプトを入力として受け取る **画像アップロード画面** を追加
- 自然言語プロンプトを固定構造（`entity_type` / `animation_type` / `required_regions` / `optional_regions` / `params`）に変換する **LLM 解析層** を追加
- 固定語彙（`body` / `tail` / `mouth` / `fin`）でマスクを指定する **部位ラベル付け UI** を追加。`body` は不透明領域から自動初期化し、後処理フィルタ（不透明領域外クリップ / 小穴補完 / 孤立ピクセル除去）を適用
- 4 種の固定テンプレートアニメ（`swim_slow` / `turn` / `approach_food` / `eat`）を同期生成する **テンプレート Renderer** を追加。GIF とスプライトシート PNG を出力
- 元画像・マスク・project.json・出力物を保存し、再読込・再編集できる **project 永続化** を追加（`version` / `renderer_version` を含む再現性重視スキーマ）
- Next.js ベースの Web アプリとして提供。Supabase を基盤に採用し、Postgres（ユーザー / project metadata / 生成回数カウント / 課金状態）、Storage（source.png / mask.png / result.gif / spritesheet.png）、Auth を統合
- LLM プロバイダは Anthropic Claude API（`claude-haiku-4-5` を既定、構造化出力を `tool_use` で強制）
- 同期生成の上限を固定: **入力画像 ≤ 512x512px / 出力 16 フレーム / 8fps**（数秒以内に完了する範囲）
- 基本認証 + フリーミアム制限チェックを MVP スコープに含める（Free プランは生成回数・保存件数に上限、Paid は Stripe 最小統合。具体数値は design/clarify で確定）

MVP 非対応: 魚以外の本格対応、複数個体、全自動部位推定、動画入力、物理シミュレーション、非同期ジョブ基盤、高度ペイント機能。

### 生成単位と境界条件

- **1 生成リクエスト = 1 animation_type**。LLM が選んだ 1 種のみを生成・保存。`project.json` と同じ単数契約。
- **曖昧プロンプト時**: 部位指定画面で LLM 選択結果（`animation_type`）をドロップダウンでユーザーが確認・上書き可能。確定した値が `final_animation_type` として保存される。
- **部位欠損時**: `required_regions` が空マスクでも生成は続行（fallback: body 全体の僅かな変形）。UI は警告を表示するがブロックはしない。
- **無料枠**: ログイン必須。Free プランは月次 **生成成功 10 回 / 保存 5 件** を上限。再生成と失敗はカウントしない。Paid は Stripe で月額課金、上限拡大。
- **互換契約**: MVP は `renderer_version = 1` のみサポート。異なる version の project は読み取り専用（表示のみ、再生成ボタンを無効化し警告表示）。
- **失敗時**: 生成は **30 秒タイムアウト**。失敗・タイムアウトはエラー UI を表示、再試行を促す。失敗分は生成回数カウントに含めない。project は保存されない。
- **入力拒否条件**: 非透過 PNG（alpha channel なし）、JPEG、アルファが全不透明な PNG は MVP ではサーバー側でバリデーションし拒否。

## Capabilities

### New Capabilities

- `image-upload`: 透過 PNG のアップロードとプレビュー、自然言語プロンプト入力欄を提供（≤ 512x512px の入力サイズ制約を強制）
- `user-auth-billing`: Supabase Auth ベースのユーザー認証と、フリーミアム制限（生成回数 / 保存件数）チェック、Stripe 最小統合による Paid プラン移行
- `nl-animation-parsing`: 自然言語プロンプトを固定構造の LLM 結果（`animation_type` 固定列挙 + `required_regions` + `optional_regions` + `params`）に変換。Anthropic Claude API（`claude-haiku-4-5`）を使用し、`tool_use` で JSON schema 出力を強制
- `region-masking`: 固定語彙のマスク編集 UI（ペン / 消しゴム / 塗りつぶし / ズーム / ラベル切替 / Undo / 重ね表示）、`body` 自動初期化、後処理補正フィルタ
- `template-animation-renderer`: 4 種の固定テンプレート（`swim_slow` / `turn` / `approach_food` / `eat`）をマスクベースの画像変形で生成し、GIF とスプライトシート PNG を同期出力。上限: 入力 ≤ 512x512px / 16 フレーム / 8fps
- `project-persistence`: `project.json`（version, entity_type, prompt, llm_result, final_animation_type, final_params, region_palette, outputs, renderer_version）と関連資産（source.png / mask.png / result.gif / spritesheet.png）を保存・再読込・再生成

### Modified Capabilities

- None（新規プロジェクトのため既存 baseline spec なし）

## Impact

- **新規実装範囲**: Next.js フロント、Anthropic Claude API クライアント統合、マスク編集 Canvas UI、テンプレート Renderer（部位変形 + フレーム合成 + GIF/sheet 出力）、Supabase Storage I/O、Supabase Postgres スキーマ（user / project metadata / 生成回数 / 課金状態）、Supabase Auth 連携、Stripe 最小統合
- **外部依存**: Anthropic Claude API、Supabase（Postgres + Storage + Auth）、Stripe、GIF エンコーダ、画像処理ライブラリ
- **同期処理前提**: 入力画像 ≤ 512x512px / 16 フレーム / 8fps に限定（ジョブキュー未導入）
- **再現性契約**: `project.json` の `version` / `renderer_version` が将来の互換管理のキー
- **非機能**: フリーミアムプランの生成上限・保存上限・商用可否を Supabase 認証層 + DB で制御（具体数値は design フェーズで確定）
- **セキュリティ**: Anthropic API key / Stripe key / Supabase service role key は環境変数で管理、クライアントには公開しない
