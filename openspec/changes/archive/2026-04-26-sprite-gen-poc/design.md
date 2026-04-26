# Design — sprite-gen-poc

## Context

これは新規のローカル PoC アプリケーションを 0 から立ち上げる change である。既存コードベースは `tsconfig.tsbuildinfo` と `node_modules/` 程度しかなく、後方互換性の制約は無い。

検証目的は次の 3 点（proposal §Why より）:

- 自然言語 → LLM が必要部位とアニメ種別を構造化出力できるか
- 人手アノテーション前提で、固定テンプレート型 renderer がスプライト生成として成立するか
- LLM が renderer 設定を組み立てる方式（方式 A）が PoC として実用になるか

ステークホルダーは個人開発者（@yuki）1 名のみ。利用シナリオはローカル開発機での 1 ユーザー操作。SaaS 化や本番運用は射程外。

成功条件は proposal §Impact の受け入れ条件 10 項目（PNG アップロード〜project 再読込まで）。

## Goals / Non-Goals

**Goals:**

- ローカル PC 1 台で `swim_slow` と `eat` の 2 アニメーションを生成・保存・再読込できる動く PoC を 1 ヶ月以内に完成させる。
- LLM の出力契約を厳密に固定し、モデル変更や CLI バージョン違いでも壊れにくいスキーマ駆動設計にする。
- マスクとレンダリングの 100% を「決定的なテンプレート + 人手マスク」で扱い、LLM 出力の不確実性を `params` と `args` の数値範囲だけに閉じ込める。
- 1 project に複数 animation を時系列に積み上げる UX を成立させる（再 prompt フロー）。
- Renderer / LLM 失敗時に project が壊れないようにする（書き込みは成功時のみ）。

**Non-Goals:**

- 全自動部位推定、ピクセル単位の自動セグメンテーション、LLM による精密マスク生成。
- 認証 / マルチユーザー / 課金 / ジョブキュー / クラウド保存。
- 魚以外の entity_type 対応、複数個体同時処理。
- 動画入力、物理シミュレーション、自由形式の複雑アニメ生成。
- 高機能ペイントツールとしての完成度（ペン感圧、ブラシ種類、レイヤーなど）。
- `turn` / `approach_food` テンプレートの実装（オプション扱い）。
- 方式 B（LLM 生成コード）と generic renderer DSL。

## Concerns

| ID | Concern | 解決する問題 |
|---|---|---|
| C-INPUT | PNG アップロードと出力条件の受付・検証 | ガベージインを早期に弾き、後段（LLM・renderer）のエラー範囲を狭める |
| C-LLM-PLAN | 自然言語 prompt から固定スキーマの初回 plan を取得 | LLM の自由度を「animation_type 列挙 + params enum」に閉じ、後段が構造的に処理できるようにする |
| C-MASK | body 自動初期化と tail/mouth/fin の手動アノテーション | 部位境界という「LLM が苦手」な情報を人手で確実に与え、renderer の入力契約を成立させる |
| C-LLM-CFG | アノテーション後の args 算出 | renderer template id と数値 args という小さな出力空間に LLM を閉じ込め、PoC で扱える |
| C-RENDER | swim_slow / eat の 2 テンプレートで実フレームを生成 | 受け入れ条件「最低 2 種以上のアニメ」を満たす最小構成 |
| C-PROJECT | project 単位の永続化と複数 animation 管理 | 同一 source/mask 上で複数 animation を試せる UX、再現性、再編集 |
| C-SHELL | UI と server の責務分割、4 画面遷移 | UI ↔ server ↔ LLM/renderer の境界を明確にし、テストとデバッグを容易にする |
| C-FAIL | LLM CLI 失敗時の振る舞い | project を破損させずユーザーに復帰可能なエラー UX を提供する |

## State / Lifecycle

**Project lifecycle (initial animation path = canonical order):**

```
[新規] --upload PNG--> [draft (source only, body auto-init)]
       --prompt + LLM plan--> [plan_resolved (params editable, missing_masks list)]
       --params edit--> [plan_finalized]
       --annotate masks for required/optional regions--> [annotated]
       --LLM renderer-config--> [config_draft (args editable)]
       --args edit + render success--> [animations[].appended]
       --reload existing--> [reopened]
       --duplicate save--> [新規 project (source/mask 引き継ぎ、animations[] 空)]
       --add another animation (subsequent animations on same source/mask)--> [plan_resolved] ...
```

注意: 初回 animation のフローは spec の require どおり「upload → llm-plan → params edit → annotation → renderer-config → args edit → render」の順で進む。アノテーション画面は `plan_resolved` の `required_regions`/`optional_regions`/`annotation_schema` を受け取って表示するため、必ず llm-plan 取得後に到達する。2 回目以降の animation でもアノテーション画面は **常に経由する**（spec が「LLM が必要部位を提示 → 人間がアノテーション」を必須ステップとして定義しているため）が、既存マスクをプリロード表示し、`missing_masks` が空の場合は「変更なしで続行」ボタンを目立たせる「Skip-friendly」モードに切り替える。これによりユーザーは optional regions の追加や既存マスクの微修正の機会を毎回得つつ、変更不要なら 1 クリックで renderer-config に進める。

各状態は project ディレクトリの存在物（永続化された場合）またはサーバー内メモリ（一時状態）で表現される（DB なし、ファイルが正）:

- `draft`: `source.png` あり、`mask/body.png` あり（自動初期化）、`mask/tail.png` 等は未生成、`animations[]` 空。
- `plan_resolved`: LLM が初回 plan を返却済み。サーバーが params をデフォルト補完した `resolved_plan` を `_drafts/active/plan.json` に永続化し、UI に返す。UI はフォームで `params` を編集中。`PATCH /projects/{id}/active-draft/params` でユーザー編集を draft に反映する。`resolved_plan` レスポンスには `missing_masks`（plan の `required_regions` のうち content-based 判定で空となったラベルのリスト、後述「Mask presence rule」を参照）が含まれる。`missing_masks` が非空の場合、UI はユーザーをアノテーション画面へ遷移させ、不足ラベルの追加・修正を促す。マスク追加後、ユーザーは `renderer-config` ステップに進む（plan の再取得は不要、`_drafts/active/plan.json` を引き続き使用）。
- `plan_finalized`: ユーザーが `params` の編集を確定し、アノテーション画面へ遷移する直前の状態。`_drafts/active/plan.json` には最終 params が保存されている。`resolved_plan` の `required_regions`/`optional_regions` が UI に表示される。
- `annotated`: `mask/<label>.png` 群がディスク上に存在し、内容ベース判定で `required_regions` を満たしている（`missing_masks` が空）。
- `config_draft`: LLM が renderer-config（`renderer_template` + `args` + `loop`）を返却済みで、`_drafts/active/renderer_config.json` に永続化されている。UI がフォームで `args` を編集中、`PATCH /projects/{id}/active-draft/renderer-config` で draft に反映する。まだ最終レンダリングは実行されていない。Re-generate フローでも同じ draft slot を経由する（前回の args をフォーム初期値として表示し、ユーザーが編集してからレンダリングを実行する）。
- `generating`: 一時的なメモリ上状態。renderer は temp dir に出力を書き出す。
- 成功すると `animations/<animation_id>/` ディレクトリと `project.json.animations[]` のエントリ（v3 schema 形）が atomic に書き込まれ、`_drafts/active/` がクリアされる。

**Canonical state（唯一の真実）:**

- `projects/<project_id>/source.png`: 入力画像のオリジナル
- `projects/<project_id>/mask/<label>.png`: ラベルごとの二値マスク
- `projects/<project_id>/project.json`: 出力条件、各 animation の v3 schema エントリ（`animation_id`, `prompt`, `llm_plan`, `params`, `annotation.labels_present`, `renderer_config_path`, `outputs.gif_path`, `outputs.spritesheet_path`, `renderer_version`, `created_at`, `updated_at`）、時刻。`mask_labels_present` や args の値は project.json には保存しない（args は `renderer_config_path` 先のファイルに分離）。
- `projects/<project_id>/animations/<animation_id>/result.gif`, `spritesheet.png`, `renderer_config.json`

**Derived state（再計算可能）:**

- `duration_sec = frame_count / fps`（UI 表示のみ）
- 「derived body」 = `body \ (tail ∪ mouth ∪ fin)`（renderer の判定優先順位ルールから導出）
- thumbnail（project library 表示用、source.png から都度生成）

**Persistence-sensitive state:**

- LLM 失敗時の「直前まで入力されていた prompt + output 条件」: 失敗時もユーザーが retry できるよう、メモリ上で保持しつつ project にはまだ書き込まない（成功時のみ追記）。
- サーバープロセス再起動で揮発してよい（PoC のため）。永続化は不要。

## Contracts / Interfaces

**Layer 構成:**

```
[UI (React+Vite, :5173)]
        |
   HTTP/JSON (FastAPI :8000)
        |
[Server (FastAPI + uvicorn)]
        |    |    |
        |    |    +--> [Renderer (in-process Python)]
        |    +-------> [File system: projects/<id>/]
        +------------> [LLM CLI subprocess: claude]
```

**HTTP API（最小集合）:**

| Method | Path | Body | 200 Response | 失敗 |
|---|---|---|---|---|
| `POST` | `/projects` | multipart: `source` (PNG) + JSON `output` | `{project_id, source_dim:{w,h}, output:{...}, color_mode_converted:bool}` | 400 (validation) |
| `GET` | `/projects` | — | `{projects:[{project_id, thumbnail_b64, animation_summaries, updated_at}]}` | — |
| `GET` | `/projects/{id}` | — | **canonical response shape** (single contract; tasks.md task 1.1 / 3.3 align): `{project_id, schema_version: "v3", entity_type, source_url, masks: {<label>: <url>}, mask_dir, output, animations: [<v3-entry-with-renderer-config-inlined>...], mask_presence: {<label>: bool}, active_draft: {has_plan, has_renderer_config, plan?, renderer_config?}, created_at, updated_at}`. Each animation entry carries every persisted v3 field (`animation_id, prompt, llm_plan, params, annotation: {labels_present: [...]}, renderer_config_path, outputs: {gif_path, spritesheet_path}, renderer_version, created_at, updated_at`) plus an inlined `renderer_config` object resolved from `renderer_config_path` and `outputs.gif_url` / `outputs.spritesheet_url` resolved from `outputs.gif_path` / `outputs.spritesheet_path` (both null when the corresponding path is null). All URLs point at the static-asset mount described in the "Static-asset serving" section. | 404 |
| `POST` | `/projects/{id}/duplicate` | — | `{project_id: <new>}` (source/mask のみコピー、animations は空) | 404 |
| `DELETE` | `/projects/{id}` | — | `204` | 404 |
| `POST` | `/projects/{id}/masks/{label}` | grayscale PNG bytes | `{label, persisted_path, dims:{w,h}, mask_url, has_content: bool}` (the response also returns the post-filter mask bytes via `Content-Type: image/png` when the request includes `Accept: image/png`, otherwise the JSON shape above with `mask_url` pointing at the static-mount URL the canvas can re-fetch to display the filter-applied mask) | 400 (validation), 404 |
| `POST` | `/projects/{id}/llm-plan` | `{prompt}` | `{resolved_plan:{...}, missing_masks:[str]}` (also writes `_drafts/active/plan.json`) | 422 (LLM error variants) |
| `PATCH` | `/projects/{id}/active-draft/params` | `{params:{...}}` | `{plan:{...}}` (updates `_drafts/active/plan.json`) | 404 if no active draft, 400 if invalid |
| `POST` | `/projects/{id}/renderer-config` | `{}` (server reads `_drafts/active/plan.json`) | `{renderer_config:{renderer_template, args, loop, plan_token, created_at}}` (the **persisted draft shape** including server-added `loop`/`plan_token`/`created_at`; same content as `_drafts/active/renderer_config.json`) | 422 (LLM error variants), 404 if no plan draft |
| `PATCH` | `/projects/{id}/active-draft/renderer-config` | `{args:{...}}` (only `args` is editable; `renderer_template`, `plan_token`, and `loop` are server-managed and rejected with 400 if present) | `{renderer_config:{...}}` (updates `_drafts/active/renderer_config.json`) | 404 if no draft, 400 if invalid or contains forbidden keys |
| `POST` | `/projects/{id}/animations` | `{}` (server reads `_drafts/active/{plan,renderer_config}.json`) | `{animation:<v3-entry>}` and clears `_drafts/active/` | 422 (render error variants), 404 if drafts incomplete |
| `POST` | `/projects/{id}/animations/{animation_id}/re-render` | `{}` (server reads `_drafts/active/{plan,renderer_config}.json` — must have been seeded via `seed-from/{animation_id}` first) | `{animation:<v3-entry>}` (same `animation_id` and `created_at`, refreshed `params`/`renderer_config_path`/`outputs`/`updated_at`) and clears `_drafts/active/` | 422 (render error variants), 404 if animation_id not found or drafts incomplete |
| `DELETE` | `/projects/{id}/active-draft` | — | `204` (clears `_drafts/active/`, used to abandon the in-flight animation) | 404 |
| `POST` | `/projects/{id}/active-draft/seed-from/{animation_id}` | — | `{plan:{...}, renderer_config:{...}}` (server reads the prior animation's v3 entry and `renderer_config.json`, writes them into `_drafts/active/plan.json` and `_drafts/active/renderer_config.json`, then returns both) | 404 if animation_id not found, 409 if a non-empty `_drafts/active/` already exists (UI must DELETE it first or pass `?overwrite=true`) |

**PNG color mode handling (`POST /projects`):**

- RGBA: そのまま受理。
- RGB: サーバー側で全ピクセルの alpha を 255 に設定して RGBA に変換し、`source.png` として保存する。`body.png` は全不透明（全白）で初期化される。レスポンスに `color_mode_converted: true` を含め、UI は「全面が body として初期化された」旨を表示する。
- Grayscale (mode="L"): サーバー側で RGB に変換した上で alpha=255 を付与して RGBA に変換する。以降は RGB と同様。
- その他のモード (P, CMYK 等): 400 で拒否する。

**Mask editor contract:**

- **対象ラベル**: `body` / `tail` / `mouth` / `fin` の全 4 ラベルを編集可能にする。`body` は自動初期化されるが、RGB/grayscale アップロードで全面不透明になった場合にユーザーが手動で body 領域を修正できる必要がある。
- **必須ツール**: `pen` / `eraser` / `bucket fill` / `zoom` / `undo` / `label switch`（4 ラベル間の切替）。
- **補助フィルタ（編集ごとに適用、ラベル別）**: spec `mask-annotation-ui` の Requirement「Auxiliary mask filters」が "After every edit" を要求しているため、UI は各編集ストローク後にすぐ filter 適用済みのマスク状態を反映表示する。実装:
  - **クライアント側**: pen / eraser / bucket fill / undo の各操作後、UI は当該ラベルの最新マスクをサーバーへ即時 `POST /projects/{id}/masks/{label}` で送信し、サーバーが filter（下記ルール）を適用した結果を返却する。UI は返ってきた filter 適用後のマスクを Canvas にロードし直すことで「編集 → 保存 → 反映」の往復を 1 ストロークごとに完結させる。これにより Canvas 上のマスク表示は常にディスク永続化と一致する（揺れない）。
  - **サーバー側 filter ルール**: `tail` / `mouth` / `fin` には `clip-to-source`（source の `alpha >= 128` 外のマスクピクセルを除去）、`hole-fill`（マスク内の小さな穴を補完）、`isolated-pixel-removal`（孤立ピクセルを除去）の 3 フィルタをすべて適用。`body` にはフィルタを適用しない（spec が body への cleanup を禁止しているため、ユーザー編集後の値をそのまま永続化）。
  - **送信頻度の最適化**: 連続 stroke のスパムを避けるため、UI は 200ms のデバウンスで POST をまとめてもよいが、最後の編集が送信されるまで「保存中…」を表示し、応答後に「保存済み」表示に切り替える。
- **derived body 表示**: UI は `body \ (tail ∪ mouth ∪ fin)` を overlay として任意で表示可能。

**Server ↔ LLM CLI:**

- 起動: `claude --print --output-format json` を subprocess.Popen で起動。
- stdin: 構造化プロンプト（system + user セクション、期待スキーマを inline で示す）。
- stdout: JSON。`extractJsonFromMarkdown` 相当のヘルパで json コードフェンス内も抽出可能にしておく（CLI 出力ゆらぎ対応）。
- timeout: 60 秒（`subprocess.communicate(timeout=60)`）。
- 失敗種別 → HTTP エラー対応:

  | 失敗 | error_kind | retriable | HTTP |
  |---|---|---|---|
  | `claude` バイナリ未検出 | `llm_cli_not_found` | false | 503 |
  | non-zero exit | `llm_cli_exit_nonzero` | true | 422 |
  | stdout 空 | `llm_cli_empty_output` | true | 422 |
  | JSON 解析失敗 | `llm_invalid_json` | true | 422 |
  | スキーマ不一致 | `llm_schema_mismatch` | true | 422 |
  | timeout | `llm_timeout` | true | 504 |
  | 認証未完了 (CLI が対話プロンプトを出した場合) | `llm_auth_required` | false | 401 |

**Generate flow alignment with `local-app-shell` spec:**

The `local-app-shell` spec scenario "UI requests animation generation through the server" says clicking "Generate" on the Annotation screen POSTs to `/animations` (or equivalent) and the server coordinates the second LLM call and the renderer call before responding with the new animation entry. The spec's "(or equivalent)" parenthetical and the requirement that the server "coordinate" multiple operations are interpreted here as a **multi-step orchestration** that begins when the user clicks Generate, not a single atomic HTTP call. The concrete refinement is:

1. Annotation screen → user clicks **Generate** → UI calls `POST /projects/{id}/renderer-config` (the "(or equivalent)" entry point the spec leaves open). The server makes the second LLM call, validates the response, and writes `_drafts/active/renderer_config.json`.
2. Result screen → UI loads the draft into the args-editable form (per `llm-renderer-config` spec Requirement "User can re-edit args before render", which mandates this editability and would conflict with a single-call model).
3. User edits args → clicks **Render** → UI calls `POST /projects/{id}/animations`. The server runs the renderer in a staging dir, atomically commits to `animations/<animation_id>/`, appends to `project.json.animations[]`, and returns the new v3 entry.

The total user-facing experience matches the spec scenario ("click Generate → eventually receive an animation entry"); the multi-step server orchestration is what makes the args-edit step possible while satisfying both `local-app-shell` and `llm-renderer-config` requirements simultaneously.

**Authoritative editable state (single source of truth):**

Edit-able animation state lives in **exactly one place per category** to avoid divergence:

- `params` (`speed`, `amplitude`, `emphasis`, `loop`): the authoritative copy is the **top-level `params` field of `_drafts/active/plan.json`**. The `llm_plan` field within the same file is the **normalized resolved plan** — it is the LLM response after server-side schema validation and default-filling for missing/null params. `llm_plan` is read-only after llm-plan completes (no edits via PATCH). `PATCH /projects/{id}/active-draft/params` updates ONLY the top-level `params` object and never `llm_plan.params`. When the v3 animation entry is finalized at render commit, the entry's `params` field is the user-edited value (potentially diverging from `llm_plan.params` if the user edited speed/amplitude/emphasis/loop) and the entry's `llm_plan` is the normalized resolved plan from the draft (the same value that was persisted at llm-plan time).
- `loop` propagation: `params.loop` is the **single authoritative value**. The `loop` field in `_drafts/active/renderer_config.json` is a **derived snapshot** captured at the moment of `POST /projects/{id}/renderer-config` — it copies `params.loop` from the plan draft and is read-only thereafter. `PATCH active-draft/renderer-config` MUST NOT accept a `loop` field in its request body (reject with 400 `loop_is_authoritative_in_params` if a client sends one). To change loop behavior, the user edits `params.loop` via `PATCH active-draft/params`; that triggers the renderer_config invalidation rule which deletes the existing renderer_config draft, and the next `POST renderer-config` call re-derives `loop` from the updated params. This guarantees `params.loop`, `renderer_config.json.loop`, the actual render behavior, and the persisted `animations[].params.loop` cannot diverge.
- `args` (numeric renderer parameters): the authoritative copy is the **`args` field of `_drafts/active/renderer_config.json`**, edited via `PATCH active-draft/renderer-config`. There is no copy of args inside the plan draft.

This means:

- An animation's `llm_plan` field is "what the LLM proposed" (immutable after llm-plan).
- An animation's `params` field is "what the user finalized at render time" (editable until commit).
- An animation's `renderer_config.json` (referenced by `renderer_config_path`) is "the exact `{renderer_template, args, loop}` triple used by render() at commit time".
- At v3 entry commit, all three are written from the draft state. They MUST NOT diverge after that — Re-generate (see §"Re-generate semantics" below) updates the SAME `animations[]` entry in place (preserves `animation_id` and `created_at`, refreshes everything else); Add another animation appends a fresh entry. There is no third option.

**Re-generate semantics (per spec local-app-shell):**

The Result screen exposes two distinct actions:

- **Re-generate** = "re-run renderer with current args" (spec language). Implementation: the user adjusts args on the args-edit form (loaded from the prior animation's `renderer_config.json` via `seed-from`), then triggers render. The new render output **overwrites** the existing animation's outputs (`result.gif`, `spritesheet.png`, `renderer_config.json`) and updates the entry's `params`/`renderer_config_path` content and `updated_at` field in place. The `animation_id` and `created_at` are preserved. This matches "re-run with current args" without proliferating animation entries; users who want to keep history use "Add another animation" instead. Implementation flow: `POST /projects/{id}/animations/{animation_id}/re-render` reads `_drafts/active/{plan,renderer_config}.json`, executes render into a sibling staging dir under `animations/.tmp/<animation_id>/`, atomically replaces the existing `animations/<animation_id>/` directory, and updates the corresponding `animations[]` entry (preserving `animation_id` and `created_at`, refreshing everything else).
- **Add another animation** = "fresh prompt within same project". Implementation: clears the active draft, presents the prompt input on the Input screen, runs the full upload→llm-plan→params edit→annotation (if missing_masks)→renderer-config→args edit→render flow, and appends a NEW `animations[]` entry with a fresh `animation_id` (existing entries are untouched).

The `seed-from` endpoint is the bridge for Re-generate: it copies the prior animation's plan/config into `_drafts/active/` so the user can edit args and trigger a re-render of that same `animation_id`.

**Active-animation draft persistence (spec compliance):**

Spec `llm-plan-analysis` の Scenario「Valid plan accepted」と「User edits speed before annotation」は accepted plan と編集後 params の persistence を、spec `llm-renderer-config` の Scenario「Valid renderer config accepted」は accepted renderer config の persistence を要求している。これを満たすため、design は以下の draft 永続化スロットを定義する:

**Re-generate からの draft seed (in-place re-render の前段):**

- Re-generate ボタンは UI から `POST /projects/{id}/active-draft/seed-from/{animation_id}?overwrite=true` を呼び、サーバーが指定された既存 animation の v3 エントリ（`prompt`, `llm_plan`, `params`, `annotation.labels_present`）と `renderer_config.json`（`renderer_template`, `args`, `loop`）を読み、新しい draft として `_drafts/active/plan.json` と `_drafts/active/renderer_config.json` に書き込む（`plan_token` は新規発行、両 draft で同一）。レスポンスにはシードされた両 draft の内容を返し、UI は args 編集フォームに直接遷移する。
- このフローは LLM 呼び出しを一切伴わない（既存値の再利用のみ）。続いて UI が `PATCH active-draft/renderer-config` で args を編集し、`POST /projects/{id}/animations/{animation_id}/re-render` を呼ぶと **同じ `animation_id` の既存エントリを in-place で更新する**（`animation_id` と `created_at` を維持し、`params`/`renderer_config_path` 内容/`outputs`/`updated_at` を refresh）。新しいエントリは作成しない。これは spec local-app-shell の "Re-generate = re-run renderer with current args" 要求と一致する。履歴を残したいユーザーは「Add another animation」を使う。
- seed-from は `?overwrite=false`（デフォルト）で既存 draft が存在する場合 409 を返し、UI は確認ダイアログ後に `?overwrite=true` で再投入する。
- 「Add another animation」は `seed-from` を使わず、Input 画面で新しい prompt + llm-plan の通常フロー（POST /animations のフルパス）を経て新しい animation エントリを追加する。

**In-place re-render の永続化戦略 (POSIX 制約対応):**

POSIX `os.rename` は宛先が non-empty directory のとき機能しないため、in-place re-render は **directory-replace ではなくファイル単位の atomic rename** で実装する:

1. staging dir `projects/<id>/animations/.tmp/<animation_id>/` に新しい `renderer_config.json` / `result.gif`? / `spritesheet.png`? を書き出す。
2. 既存 `animations/<animation_id>/` を `animations/.tmp/<animation_id>.bak/` にリネーム（rename は同一 fs 内 directory-to-non-existent-directory なので atomic）。
3. 新しい staging dir を `animations/<animation_id>/` にリネーム（rename は宛先が無いので atomic、prior step で空にした）。
4. 失敗時の rollback: step 3 が失敗したら `.bak` を元に戻す。step 2 が失敗したら staging dir を破棄するだけ。
5. 成功確認後、`.bak` を `shutil.rmtree` で削除。
6. このシーケンスは「ファイル単位の atomic rename を組み合わせて directory swap を擬似的に実現する」既知のパターン（`backup-and-replace`）であり、各 step は POSIX 上で原子的に進む。クラッシュ recovery は起動時の cleanup が `.bak` を見つけたら復元するように実装する。
7. project.json の `animations[]` 該当エントリの更新は別の atomic rename（`project.json.tmp → project.json`）で行い、step 5 のあとに実行する（順序: bak → rename → project.json 更新 → bak 削除）。

これにより spec のセマンティクス（in-place re-render）と POSIX の rename 制約の両方を満たす。

**Active-draft slot 詳細:**

- 各 project は最大 1 つの「active draft」を保持できる（次に render される予定の animation）。draft は `projects/<project_id>/_drafts/active/` 配下に書き込む:
  - `_drafts/active/plan.json`: `POST /projects/{id}/llm-plan` 成功時に `{prompt, llm_plan: <resolved_plan>, params, missing_masks, plan_token: <ULID/UUID>, created_at}` を書き込み、UI からの params 編集 (`PATCH /projects/{id}/active-draft/params`) で `params` を更新する。`plan_token` は plan が新規作成・置換されるたびに発行される一意識別子（renderer_config 整合性検査の照合キー）。
  - `_drafts/active/renderer_config.json`: 2 種類の契約に注意:
    - **LLM 応答スキーマ**: `{renderer_template, args}` のみ（spec `llm-renderer-config` の Requirement「Renderer config output schema」に準拠。`loop` は LLM から受け取らない）。
    - **永続 draft スキーマ**: `{renderer_template, args, loop, plan_token, created_at}`。サーバーが LLM 応答に加えて `loop`（`_drafts/active/plan.json` の `params.loop` から）と `plan_token`（同 plan.json から）と `created_at` を **追加** して書き込む。
    - UI からの編集 (`PATCH /projects/{id}/active-draft/renderer-config`) は `args` のみ更新可能。`renderer_template` / `plan_token` / `loop` はすべてサーバー管理項目で、PATCH ではいずれも変更不可（含む body は 400 で拒否）。`loop` を変えたいユーザーは `PATCH active-draft/params` で `params.loop` を変更し、これにより既存 renderer_config draft が invalidation rule で削除され、次回の `POST renderer-config` 呼び出しで `loop` が再導出される。

**Active-draft invalidation rule (stale renderer_config 防止):**

- `POST /projects/{id}/llm-plan` が新しい `plan_token` を発行したとき、サーバーは **必ず** 既存の `_drafts/active/renderer_config.json` を削除する（前 prompt 由来の args が残ることを防ぐ）。これは llm-plan が成功して plan.json を書き出す前の同一 transaction 内で実行する。
- `PATCH /projects/{id}/active-draft/params` で `params` が変更された場合、`emphasis` / `loop` などの値変化が renderer_config の前提を破る可能性があるため、サーバーは `_drafts/active/renderer_config.json` も削除する（次の `POST /projects/{id}/renderer-config` で再生成される）。
- `POST /projects/{id}/animations` 実行時、サーバーは `plan.json.plan_token` と `renderer_config.json.plan_token` が一致することを検査する。不一致なら 409 (`renderer_config_stale`) を返し、UI に renderer-config を再呼び出しするよう促す（実装上は両 draft が揃うまで render を実行しない）。
- `POST /projects/{id}/active-draft/seed-from/{animation_id}` で再シードする場合、新しい `plan_token` を発行して両 draft に同じ token を書く（停止せず一貫した状態を作る）。
- `GET /projects/{id}` レスポンスの `active_draft` に `plan_token` を含め、UI は token 不一致を検知したらユーザーに警告と再投入を促す（最終ガードはサーバー側）。
- `_drafts/active/` は git ignore 対象（`projects/` 全体が ignore）。サーバー再起動後も draft が残るため、ユーザーは中断した動作を継続できる。
- `POST /projects/{id}/animations` 実行時、サーバーはまず `_drafts/active/` の現状を読み、新しい `animation_id`（slug）を採番して、temp dir に renderer 出力を書き出してから atomic に `animations/<animation_id>/{renderer_config.json, result.gif?, spritesheet.png?}` を作成し、`project.json.animations[]` に v3 schema エントリを追記する。コミット成功後に `_drafts/active/` を削除する（クリーンアップ）。
- 新しい prompt（次の animation の開始）が POST されると、既存の `_drafts/active/` は新しい plan で上書きされる（前 draft はコミットされていなければ破棄）。
- `GET /projects/{id}` レスポンスには `active_draft` フィールドを追加し、`{has_plan: bool, has_renderer_config: bool, plan?: ..., renderer_config?: ...}` を返す。UI は再読込時に draft の有無で「params 編集の続き」「args 編集の続き」のどちらに復帰するかを判定する。
- `_drafts/active/` の中身は v3 schema の一部ではない（spec は完成済み animation の永続化形だけを規定する）。draft 用の独立ファイル形式として扱う。
- 失敗（render エラー、サーバークラッシュ、ユーザー離脱）が発生しても `_drafts/active/` には影響を与えず、retry 時に同じ入力を再投入できる。

**LLM plan normalization（`POST /projects/{id}/llm-plan` 内）:**

- LLM 返却の `animations[]` 配列が 2 要素以上を含む場合は `llm_schema_mismatch` として 422 を返す（1 prompt = 1 animation の契約を強制）。
- **animation_type 受理範囲**: spec `llm-plan-analysis` のスキーマ受理範囲に準拠し `swim_slow` / `turn` / `approach_food` / `eat` の 4 種を受理してから、PoC 実装範囲外の type を `unsupported_animation_type_for_poc` (422) として **plan resolution の直後・annotation 案内の前** に弾く（fail-fast）。実装上は llm-plan エンドポイントが LLM 応答を schema 検証してから `ANIMATION_TYPE_TO_TEMPLATE[plan.animation_type]` を参照し、`None` の場合は `_drafts/active/plan.json` を **書き込む前に** 422 を返す。これによりユーザーが annotation 画面に進んだあとで初めて失敗するという UX を避けつつ、spec の plan-stage schema 契約を狭めない（schema validation は通った上で、PoC 実装範囲ガードという別レイヤで弾く）。
- **animation_type → renderer_template の正準マッピング**: サーバー内に固定 dict を持つ:
  ```
  ANIMATION_TYPE_TO_TEMPLATE = {
    "swim_slow": "fish_swim_slow_v1",      # PoC で実装
    "eat":       "fish_eat_v1",             # PoC で実装
    "turn":           None,                 # PoC では未実装（None = unsupported）
    "approach_food":  None,                 # PoC では未実装（None = unsupported）
  }
  ```
  `None` のエントリは「PoC で対応する template が存在しない animation_type」を表す。`POST /projects/{id}/renderer-config` は LLM 応答を受け取った後、(a) `renderer_template ∈ template_registry` を確認、(b) `ANIMATION_TYPE_TO_TEMPLATE[plan.animation_type]` を取得して `renderer_template` と一致するか確認、の 2 段階で検査する。詳細:
  - `ANIMATION_TYPE_TO_TEMPLATE[plan.animation_type] is None` → 422 `unsupported_animation_type_for_poc`（PoC 範囲外の type を選ばれた）。
  - 期待 template と LLM 返却の `renderer_template` が異なる → 422 `renderer_template_mismatch_for_plan_animation_type`（LLM が誤った template を選んだ）。
  - `renderer_template` が registry に無い → 422 `unknown_renderer_template`。
  これにより plan が `swim_slow` でも LLM が誤って `fish_eat_v1` を選んだ場合に検出でき、また `turn` / `approach_food` plan に対して fallback で `fish_swim_slow_v1` を選ばれる事態を防げる。
- `params` 内の欠落キーまたは `null` 値はサーバー側で `animation_type` に応じたデフォルト値で補完する（`speed`→`slow`, `amplitude`→`small`, `emphasis`→type 依存, `loop`→`true`）。
- **Missing mask detection**: 正規化後、サーバーは `resolved_plan.required_regions` のみを対象に各ラベルへ `mask_has_content(label)` を呼び出し、`false` を返したラベルのリストを `missing_masks` としてレスポンスに含める（content-based 判定。後述「Mask presence rule」を参照）。`optional_regions` は `missing_masks` の判定対象に含めない（オプションは欠けても先に進めるため）。`missing_masks` が非空の場合、UI はユーザーをアノテーション画面へリダイレクトし、不足マスクの追加を促す。マスク追加後はユーザーが `renderer-config` ステップに進む（plan の再取得は不要、`_drafts/active/plan.json` の resolved_plan を引き続き使用する）。これにより、後続 animation で新たに必要となったラベル（例: 最初に `swim_slow` で tail のみアノテーションし、次に `eat` で mouth が必要になるケース）に対応する。
- 正規化済み plan（`resolved_plan`）をレスポンスに含め、UI はこれをフォーム初期値として表示する。ユーザーが `params` を編集した後の値は `POST /projects/{id}/renderer-config` に渡される。
- `params.loop` は `renderer-config` → `renderer_config.json` → GIF export ヘルパに伝播する。`loop=true` の場合 GIF の `loop` パラメータを 0（無限ループ）に、`false` の場合 1（1 回再生）に設定する。renderer の `render()` 関数は `args` に加えて `loop: bool` を受け取る。

**Animation entry persistence（`POST /projects/{id}/animations` 内）— v3 schema 厳守:**

- `POST /projects/{id}/animations` のリクエスト body は **空** とする。サーバーは `_drafts/active/plan.json` と `_drafts/active/renderer_config.json` を唯一の入力ソースとし、両 draft が揃っていない場合は 404 (`active_draft_incomplete`) を返す。`prompt` / `llm_plan` / `params` は plan draft から、`renderer_template` / `args` / `loop` は renderer_config draft から読み取る。`labels_present` はサーバー側で `mask_has_content` を再評価して算出する。クライアントから値を受け取らないことで、API テーブルとこのセクションの記述が一致する単一の契約となる。
- render 成功時、`project.json.animations[]` の新エントリは spec `project-store` v3 schema をそのまま満たす形で書き込む:
  - `animation_id`（slug）、`prompt`、`llm_plan`、`params`、`annotation: { labels_present: [...] }`、`renderer_config_path: "animations/<animation_id>/renderer_config.json"`、`outputs: { gif_path: "animations/<animation_id>/result.gif" or null, spritesheet_path: "animations/<animation_id>/spritesheet.png" or null }`、`renderer_version: 1`、`created_at`、`updated_at`。
  - `outputs.gif_path` は `export_format ∈ {gif, both}` のとき設定し、それ以外は `null`。`outputs.spritesheet_path` は `export_format ∈ {spritesheet, both}` のとき設定し、それ以外は `null`。
  - 型・キー名・ネスト構造は spec のサンプルと完全に一致させる（`labels_present` は `annotation` 配下、renderer config は `renderer_config_path` で参照、エントリ内には renderer_config 値を埋め込まない）。
- `renderer_config.json`（`animations/<id>/` 配下）には `renderer_template` + `args` + `loop` を JSON で保存する。`prompt`、`llm_plan`、`params`、`annotation.labels_present` は `project.json` のエントリ側のみに保存する（ファイル分離）。
- `annotation.labels_present` はサーバー側で `mask/*.png` のディスク**内容**（少なくとも 1 つの非ゼロピクセルが残っているか、フィルタ適用後で判定）から自動算出する（後述「Mask presence rule」を参照）。クライアントが自己申告値を渡してもサーバー側の値で上書きする。
- 旧 PoC 草案で言及していた top-level `mask_labels_present` キーは v3 schema に存在しない。すべて `annotation.labels_present` にまとめる。

**Project reload hydration（`GET /projects/{id}` 内）:**

- `GET /projects/{id}` は Result 画面の完全復元に必要な全情報を返す。各 animation エントリに対して:
  - `project.json.animations[]` から `prompt`、`llm_plan`、`params`、`annotation.labels_present`、`renderer_config_path`、`outputs.gif_path`、`outputs.spritesheet_path`、`renderer_version`、`created_at`、`updated_at` を読み込む（v3 schema フィールドをそのまま）。
  - `renderer_config_path` が指す `animations/<animation_id>/renderer_config.json` を読み、`renderer_template`、`args`、`loop` をエントリのレスポンスに **追加で** インライン化する（永続データには触れず、UI が args 編集の初期値として扱えるようにするため）。
  - `outputs.gif_path` / `outputs.spritesheet_path` がそれぞれ非 null の場合、ファイルの存在を確認し、UI から取得可能な URL（例: `/projects/<id>/animations/<animation_id>/result.gif`）にマッピングして返す。null フィールドはそのまま null を返す。
- これにより、reopened project の Result 画面は v3 schema に整合した形でデータを取得しつつ、UI が即座に args 編集や preview 表示に進める。

**Duplicate-save contract（`POST /projects/{id}/duplicate` 内）:**

- 新しい project_id を生成し、`source.png` と `mask/*.png` のみをコピーする。
- 新 project にも spec が定義するレイアウトを満たすため `animations/` ディレクトリ自体は空で作成する（中身のサブディレクトリ・ファイルはコピーしない）。これは spec `project-store` の「すべての project が `animations/` を持つ」レイアウト契約を維持しつつ animation 履歴を持ち越さないための運用。
- `project.json` は新しい project_id と現在時刻で `version: 3, animations: []` に再生成する。出力条件（`output`）は元 project から引き継ぐ。
- spec が要求する「duplicate-save は source.png と mask/*.png のみを引き継ぎ、animation 履歴なしの新規 project を作る」契約を厳守する。

**Mask presence rule (内容ベース判定):**

- `annotation.labels_present` および `missing_masks` の判定は、**ファイル名の存在ではなく、保存後マスクのピクセル内容**で決定する。判定規則:
  - サーバー側に共通ヘルパ `mask_has_content(label) -> bool` を実装する。`mask/<label>.png` を読み、フィルタ適用後（`tail`/`mouth`/`fin` は `clip-to-source` + `hole-fill` + `isolated-pixel-removal`、`body` はフィルタなし）に**少なくとも 1 ピクセルが非ゼロ**であれば `true`、そうでなければ `false`。
  - `mask/<label>.png` がディスクに存在しないラベルは `false`（content なし）。
  - 「全黒の mask file が残置されている」「フィルタによってマスクが空になった」「ファイルは消されたが project.json に痕跡がある」のいずれのケースも、`mask_has_content` は `false` を返す。
- `POST /projects/{id}/llm-plan` の `missing_masks` レスポンスは `resolved_plan.required_regions` のうち `mask_has_content(label) == false` であるラベルのリストとして算出する。
- `POST /projects/{id}/animations` 実行時、サーバーは render 直前にすべての label について `mask_has_content` を再評価し、`required_regions` の中に false の label が残っている場合は 422 (`required_masks_missing`) を返して render を実行しない。
- `annotation.labels_present` は `mask_has_content(label) == true` のラベルだけを集めたリストとして書き込む（順序は `body, tail, mouth, fin` の固定 alphabetical-by-priority ではなく、デコード可能な定義順とする）。

**Static-asset serving:**

UI が source / mask / output アセットを取得・ダウンロードできるよう、サーバーは以下の **read-only static mount** を提供する:

- `/projects/{id}/static/source.png` — `projects/<id>/source.png` を `image/png` で返す。404 if missing.
- `/projects/{id}/static/mask/{label}.png` — `projects/<id>/mask/<label>.png` を `image/png` で返す。404 if missing.
- `/projects/{id}/static/animations/{animation_id}/result.gif` — `image/gif` で返す。404 if missing or `outputs.gif_path == null`.
- `/projects/{id}/static/animations/{animation_id}/spritesheet.png` — `image/png` で返す。404 if missing or `outputs.spritesheet_path == null`.

これらは `127.0.0.1` バインドの同一 FastAPI app から `StaticFiles` または等価の read-only handler で提供する。書き込みは禁止。`GET /projects/{id}` の `source_url`, `masks.{label}`, `animations[].outputs.gif_path|spritesheet_path` の URL 化フィールドは、**この static mount への絶対パス**を返す（例: `"http://127.0.0.1:8000/projects/abc/static/source.png"`）。Path traversal は厳密に防ぐ（`project_id` / `animation_id` / `label` は事前にスラグ正規表現で検証してからファイル解決する）。

ダウンロードは UI 側で `<a href="..." download>` を使う形に統一し、サーバー側では `Content-Disposition: attachment` を返さない（Result 画面のプレビューがそのまま再利用できる）。

**Server ↔ Renderer:**

Renderer は server プロセスに同居する Python パッケージ `sprite_gen.renderer`。

```python
def render(
    source_image: Path,
    masks: dict[Label, Path],   # {"body": ..., "tail": ..., ...}
    template_id: str,           # "fish_swim_slow_v1" など
    args: RendererArgs,
    loop: bool,                 # GIF loop setting from params.loop
    export_format: Literal["gif", "spritesheet", "both"],
    output_dir: Path,
) -> RenderOutputs:
    """Returns paths to result.gif and/or spritesheet.png; raises UnknownTemplateError, RenderError."""
```

`UnknownTemplateError` はサーバー層で 422 にマッピング。

**Renderer 内部:**

各 template は `BaseTemplate` を実装し、`(source_rgba, masks_by_label, args) -> list[frame_rgba]` を返す。フレーム合成・GIF/spritesheet 書き出しは共通ヘルパ。

**Mask 永続化フォーマット:**

- 1 ラベル = 1 PNG。grayscale (mode="L")、白(255)=該当 / 黒(0)=非該当。
- アップロード時はサーバーで `(image.mode == "L") and (image.size == source.size)` を検証、外れたら 400。

**project.json v3 schema:** spec の `project-store` で正準として定義済み。design ではこれを参照するのみ。

## Persistence / Ownership

**所有者ごとのデータ:**

| データ | 所有者 | 寿命 |
|---|---|---|
| `source.png` | `project-store` capability | project 削除まで |
| `mask/<label>.png` | `mask-annotation-ui` が更新、`project-store` が永続化 | project 削除まで |
| `project.json` | `project-store` | project 削除まで |
| `animations/<id>/renderer_config.json` | `llm-renderer-config` が生成、`project-store` が永続化 | project 削除まで |
| `animations/<id>/result.gif`, `spritesheet.png` | `template-renderer` が生成、`project-store` が永続化 | project 削除まで |
| `_drafts/active/plan.json` | `llm-plan-analysis` 成功時に書き込み、UI からの params 編集で更新 | 次の prompt で上書き、または animation コミット時に削除 |
| `_drafts/active/renderer_config.json` | `llm-renderer-config` 成功時に書き込み、UI からの args 編集で更新 | renderer-config の再呼び出しで上書き、animation コミット時に削除 |
| 失敗中の prompt / output 条件 | UI のメモリ + `_drafts/active/`（あれば） | UI ローカル: ページ離脱まで／draft: コミットまたは新 prompt まで |
| サーバーログ（標準エラー） | `local-app-shell` | プロセスの寿命のみ、永続化しない |

**ストレージ:**

- すべてリポジトリ直下の `./projects/` 配下のファイルシステム。SQLite なども使わない。
- `.gitignore` に `projects/` を必ず追加（リポジトリ運用の前提）。
- ファイル書き込みは「同一ファイルシステム内 staging dir → atomic rename」で行う。staging dir は `projects/<project_id>/animations/.tmp/<animation_id>/` を使用する（`/tmp` や別 mount を使うと cross-filesystem rename が `EXDEV` で失敗するか非アトミックになるため、必ず project tree 内に置く）。renderer はこの staging dir に `renderer_config.json` / `result.gif` / `spritesheet.png` を書き出し、サーバーが書き出し成功を確認してから `os.rename(staging_dir, projects/<id>/animations/<animation_id>)` で atomic に commit する。失敗時は staging dir を `shutil.rmtree` でクリーンアップして project は無傷。`animations/.tmp/` は project 内のサブディレクトリで、起動時または定期的に古い staging dir を掃除するヘルパを用意する（孤立した staging はサーバークラッシュ時の名残）。
- 同時書き込み防止は不要（single user, single process）。

**Artifact ownership:**

- proposal.md / design.md / spec deltas: spec 駆動なので change ブランチで管理（git）。
- `projects/`: 実行成果物なので git 管理外。

## Integration Points

**外部システム:**

- **Claude Code CLI (`claude`)**: 唯一の外部依存。subprocess 経由。バージョン依存はせず、JSON 出力契約だけで対話する。
- **ファイルシステム**: 同一マシンのローカルディスク。

**Cross-layer 依存:**

- UI → Server: HTTP/JSON のみ。UI から LLM CLI に直接アクセスすることは禁止（spec `local-app-shell` で明文化）。
- Server → Renderer: 同一プロセス内 Python 関数呼び出し。失敗は例外で表現。
- Server → LLM: subprocess 起動 → stdin/stdout JSON。
- Renderer → ファイル: temp dir に書き出し、サーバーが最終位置に move。

**Regeneration / retry / save / restore boundaries:**

- 「Re-generate」: Result 画面から特定 animation を選んで `seed-from/{animation_id}` 経由で draft をシードし、`config_draft` 状態に遷移する。直前の animation の `renderer_config`（`renderer_template` + `args` + `loop`）をフォーム初期値として表示し、ユーザーが args を確認・編集してから `POST /projects/{id}/animations/{animation_id}/re-render` に送信する。**レンダリングはユーザーが args を確認するまで実行されない**（`llm-renderer-config` が要求する editable config ステップを経由する）。LLM の再呼び出しは行わない（args の編集のみ）。Re-generate は **同じ `animation_id` を in-place で更新する** 操作（`created_at` 維持、`updated_at`/`params`/`renderer_config_path` 内容/`outputs` 更新）。新しいエントリは作成しない。
- 「Add another animation」: 新しい prompt を入力し、`llm-plan` → `plan_resolved`（params 編集 + missing_masks チェック）→ missing_masks が非空なら `annotated`（マスク追加画面）へ遷移 → マスク追加後に `renderer-config` → `config_draft`（args 編集）→ `animations` のフルステップを実行する。同一 source/mask を共有しつつ新しい animation エントリを追加する。Re-generate との違いは (1) LLM の 2 回の呼び出し（plan + renderer-config）を伴う点、(2) 新しい prompt に必要なマスクの追加が発生しうる点、そして (3) 新しい `animation_id` の entry が **追加** される点（in-place 更新ではない）。
- 「Retry」: LLM 失敗の直後、UI 側のメモリ状態（prompt と output 条件）を使って同じ payload を再送。新しい animation エントリは LLM 成功時のみ追加される。
- 「Save」: project は mask 編集の都度サーバーへ POST され、animation は render 成功時に自動永続化される。Result 画面には明示的な「Save」ボタンを配置し、押下時に `GET /projects/{id}` で最新の永続化状態を確認して「保存済み」フィードバックを表示する（実データは既に保存済みなので、ユーザーへの安心感を提供する UI アクション）。
- 「Restore」: project library から `GET /projects/{id}` を呼び、source/masks/animations を復元。

## Ordering / Dependency Notes

**Foundation（最初に着手）:**

1. `image-input-intake` の HTTP / バリデーション層 — 後段全部の入口。
2. `project-store` の v3 ファイルレイアウト + project.json の I/O ヘルパ — すべての永続化が依存。
3. `local-app-shell` の最小骨格（FastAPI app + Vite scaffold + ルート定義のスタブ）。

**Mid（foundation の上に積む）:**

4. `mask-annotation-ui` の Canvas 編集機能 + body 自動初期化。
5. `llm-plan-analysis` の subprocess ヘルパ + 初回 plan の schema validator。
6. `llm-renderer-config` の 2 回目 LLM call（`POST renderer-config`）+ args 検証。UI での args 編集フォーム。
7. `template-renderer` の `swim_slow` テンプレート、それから `eat` テンプレート。

**Top（最後に統合）:**

8. UI の 4 画面遷移と「Add another animation」フロー。
9. Project library 画面と duplicate-save / delete。
10. 失敗時 UX（エラー表示、retry、入力保持）。

**Parallel 化可能:**

- (1)〜(3) は API 契約さえ握れば UI とサーバーの並行開発可能。
- (4) と (5) は独立。
- (7) の 2 テンプレートは独立に実装できる（共通ヘルパは先に作る）。

**Dependencies on prior artifacts:**

- すべての spec delta が確定済み（proposal accepted, specs validated）。design はそれらを HOW に翻訳するだけ。
- design.md → tasks.md（このあと specflow-generate-task-graph で生成）。

## Completion Conditions

| Concern | 完了の観測条件 |
|---|---|
| C-INPUT | `POST /projects` が valid RGBA PNG を受理し、RGB/grayscale PNG を RGBA に変換して受理し、不正値 4 種（PNG 以外、>2048px、>10MB、fps/frame_count 範囲外）および非対応モード (P, CMYK 等) を 400 で弾く統合テストが通る |
| C-LLM-PLAN | mock claude CLI（fixture スクリプト）で valid/invalid plan の 5 ケースを検証し、params デフォルト補完・単一 animation 強制・schema 段階での全 4 種 animation_type 受理 + plan resolution 直後の `unsupported_animation_type_for_poc` (422) によるガード（`turn` / `approach_food` は draft が書かれる前に弾かれる）・missing_masks リスト返却・resolved_plan 返却・active-draft 永続化を含む統合テストが通る |
| C-MASK | UI から body 自動初期化 → 全 4 ラベル（body/tail/mouth/fin）をペン/消しゴム/塗りつぶし/ズーム/Undo/ラベル切替で編集 → サーバーへ POST → サーバー側で clip-to-source/hole-fill/isolated-pixel-removal フィルタ適用 → `mask/*.png` がディスクに残ることをブラウザ E2E で確認 |
| C-LLM-CFG | mock claude CLI で valid args / out-of-range / fps mismatch の 3 ケースが期待通り処理される統合テストが通り、renderer-config レスポンスの args を UI で編集してから animations POST で render を実行するフローが成立する |
| C-RENDER | `swim_slow` / `eat` の各テンプレートが固定入力（fixture mask + args）で安定的に同一 GIF / spritesheet を出すゴールデンテストが通る |
| C-PROJECT | project 作成 → 2 animation 追加 → サーバー再起動 → reload → 同じ animation 一覧（各 animation の v3 スキーマ完全エントリ: `animation_id`, `prompt`, `llm_plan`, `params`, `annotation.labels_present`, `renderer_config_path`, `outputs.gif_path`/`outputs.spritesheet_path`, `renderer_version`, `created_at`, `updated_at`、加えてレスポンスに inline された renderer_config 内容と preview）が見えることを E2E で確認。エントリに top-level `mask_labels_present` キーが**存在しない**ことを assertion で確認。duplicate-save 後の新 project で `animations[]` が空かつ `animations/` ディレクトリが空、`_drafts/active/` が無いことを確認 |
| C-SHELL | 4 画面の遷移とフォーム入力 / プレビュー表示が手動受け入れテストで PoC 受け入れ条件 10 項目を満たす |
| C-FAIL | mock claude CLI で 7 種の失敗モードを再現し、UI にエラー表示が出て project が壊れないことを確認 |

各 concern は独立に review 可能（テストが独立して通るため）。

## Decisions

| 決定 | 採用 | 代替 | 理由 |
|---|---|---|---|
| Server 言語 | Python (FastAPI) | Node/TS 一本化、Python+Flask | renderer の画像処理は Pillow/numpy が成熟し、imageio で GIF 出力も枯れている。FastAPI は Pydantic で schema 検証が直結し LLM 出力の strict 検証に向く。Flask との比較ではバリデーション統合と非同期 stdin/stdout 連携の容易さで FastAPI を採用 |
| UI フレームワーク | React + Vite (TS) | Plain HTML/JS, Svelte | Canvas 操作と複数画面 state 管理を考慮するとコンポーネント志向が要る。Vite は dev-server が速く PoC に十分 |
| LLM 通信 | Claude Code CLI subprocess | Anthropic API 直叩き、Agent SDK | issue の指定に忠実。CLI が認証を内包するので環境変数・キー管理が要らない（PoC 利点）。タイムアウトと JSON 抽出だけサーバーが担う |
| マスクフォーマット | ラベルごとの grayscale PNG | 1 枚インデックスカラー、JSON polygon | デバッグ視認性、ライブラリ親和性、UI シンプルさで勝る。重複ラベル表現も自然に可能 |
| Project storage | `./projects/<id>/` (リポ直下、git ignore) | ホームディレクトリ、SQLite, `.specflow/` | リポと一緒に「ローカルでこねる」PoC 性質に合う。ホーム配下より "明示的" でテストもしやすい |
| 1 project = N animations のフロー | 1 prompt = 1 animation を逐次追加 | 1 prompt から複数 animations を LLM がまとめて返す | プロンプト設計と検証コスト、UI の生成中表示が単純になる。ユーザー体験としても「1 つ作る → 結果見て → もう 1 つ」が自然 |
| Mask 重複ポリシー | 重複可、renderer 識別優先順 tail>mouth>fin>body | UI 側で排他、renderer で derived body 強制 | UI が単純、masks が独立 PNG として再利用しやすい、後で priority を変更しても spec 上の影響範囲が小さい |
| 必須 animation_type | `swim_slow` + `eat` | 4 種全部、最小 1 種 | 受け入れ条件「最低 2 種」を満たし、tail と mouth 両方の動きを検証できる組み合わせ。実装コストとカバレッジのバランス |
| LLM CLI 失敗時 | 全種類で auto-retry なし、project は無傷で UI に retry ボタン | transient だけ自動 retry、即座に project に失敗ログ書き込み | PoC では「失敗=人間が見る」が単純で、隠れた retry によるコスト/重複呼び出し問題を避けたい。project は必ずクリーンに保つ |
| `fps`/`frame_count`/`duration` 入出力 | fps と frame_count を入力、duration は派生表示 | duration を入力、frame_count を派生 | フレーム数が renderer のループ精度を直接決めるため、ユーザーが整数として把握できる方が PoC 観察に向く |
| Server bind | `127.0.0.1` 固定 (CORS は localhost のみ許可) | `0.0.0.0`、Tailscale 等 | local-only PoC を物理的に保証 |
| Server プロセスモデル | uvicorn 1 worker, in-process renderer | gunicorn + workers, Celery + Redis | single user, single project session 想定。並列化は不要 |
| Args 上書きルール | `fps`/`frames`/`output_*` は server 側で再度上書き | LLM 出力をそのまま採用 | LLM が UI 入力からズレた値を返すケースが観測されており、契約として server 側で再強制するのが安全 |
| 出力ファイル書き込み | temp dir に書き出して atomic rename で `animations/<id>/` を作る | renderer 直接書き込み | render 中エラーで半端なディレクトリが残らない、project の整合性を高く保つ |
| Renderer config → render の分離 | `POST renderer-config`（LLM call + args 返却）と `POST animations`（render 実行）を別エンドポイントに分割 | 1 リクエストで LLM + render を一気通貫 | spec の `llm-renderer-config` が要求する「UI で args を編集してからレンダリング」を成立させるため。UI は renderer-config の返却値をフォーム表示し、ユーザー編集後の args で animations を POST する |
| Plan normalization | サーバー側で params デフォルト補完、単一 animation 強制、resolved_plan をレスポンスに含める | LLM 出力をそのまま UI に渡す | LLM が省略した params のデフォルト値を UI がハードコードするのを防ぎ、サーバーを single source of truth にする。`loop` パラメータを renderer/GIF export 層まで確実に伝播させる |
| PoC animation_type gate の位置 | llm-plan のスキーマ検証成功後 `_drafts/active/plan.json` 書き込み前に `unsupported_animation_type_for_poc` (422) として fail-fast で弾く（renderer-config 段階の plan-template compatibility check は defense-in-depth として残す） | llm-plan のスキーマ段階で 4 種以外を拒否（spec 違反）、renderer-config 段階のみで拒否（遅すぎ） | spec `llm-plan-analysis` のスキーマは 4 種すべてを valid とするため schema 検証では狭めない。スキーマ検証直後に `ANIMATION_TYPE_TO_TEMPLATE[type]` が `None` なら 422 を返すことで、ユーザーが annotation 画面に進む前に失敗を返せ、draft 書き込みやマスク作業を無駄にしない |
| RGB/grayscale PNG の受理 | サーバー側で RGBA に変換して保存、body.png は全白で初期化 | RGBA 以外を拒否 | spec が RGB/grayscale の受理を要求。変換後の全面不透明 body を UI で編集可能にすることで、非透過入力にも対応 |

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Claude Code CLI の出力がモデルバージョンで揺れ、JSON 抽出が安定しない | strict schema validation でズレを早期検知 + 抽出ヘルパで json コードフェンス対応 + 失敗を retriable error にしてユーザーが再試行できる |
| imageio + Pillow による GIF が大きすぎる / 色数で品質劣化 | quantize 設定を template ごとに調整、必要なら apng や webp 出力をオプションで追加（PoC 後） |
| Canvas マスク描画が大きい source（2048×2048）で重い | 上限を 2048 に固定（spec で確定）、UI は内部的にダウンスケール表示し保存時にフルサイズへアップサンプル |
| body 初期化が「半透明エッジ」で甘くなる | `alpha >= 128` の閾値を契約として spec/design で明記、UI で確認できるよう overlay 表示 |
| 同一 source/mask で複数 animation を重ねると project.json が肥大化 | 上限を設けず PoC で観察、必要なら animation の archive / delete を後付けで導入 |
| LLM が `mask_labels_present` を無視して required を踏み倒す | サーバー側で「required region がマスクとして実在するか」を二重検証して 422 を返す |
| Renderer のテンプレート間で品質差が大きい | `swim_slow` を golden test の基準にして共通ヘルパを成熟させてから `eat` を載せる |
| projects ディレクトリを誤って commit | `.gitignore` への追加を foundation phase の最初に行い、CI（あれば）で `git status -s projects/` をチェック |
| 失敗時の retry でユーザーがプロンプトを編集できないと体験が悪い | UI のメモリに prompt + output 条件を保持し、retry 時にフォームへ pre-fill する |
| Single-user 想定だが、ブラウザを 2 つ開いて同じ project を編集すると mask が壊れる | PoC では「1 ブラウザ 1 project」を運用ルールで案内、サーバー側のロックは入れない |

## Migration Plan

新規 PoC のため migration はなし。

- 既存 git 状態 (`main` ブランチ) は変更しない。
- 実装は worktree `.specflow/worktrees/sprite-gen-poc/main` 上の `sprite-gen-poc` ブランチで行い、approve 後に main にマージ。
- ロールバックは「ブランチを破棄」のみで完結。

## Open Questions

- thumbnail 生成: source.png をそのままダウンサンプルする（高速、しかし複雑な絵だと潰れる）か、最初の animation の中間フレームを使う（情報量が多いが計算コスト高）か。**初期は source ダウンサンプル**で進めるが、UX を見て切り替え可能にしておく。
- Result 画面の「Re-generate」と「Add another animation」のボタンの並び・既定動作。**Re-generate は同 `animation_id` を in-place で更新**（`created_at` 維持、outputs/args refresh）。**Add another animation は新しい entry を追加**。spec local-app-shell の Re-generate 定義（"re-run renderer with current args"）に準拠し、履歴を残したいユーザーは Add another animation を選ぶ。
- 「Delete project」確認ダイアログの粒度（タイプ確認 / 二段クリック / undo）。**二段クリック**で進める（PoC では十分）。
- Vite と FastAPI を 1 コマンドで起動するスクリプト構成（`make dev` か `npm run dev` + `uvicorn` を Procfile か）。tasks 段階で確定する。
