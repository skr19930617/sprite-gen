## Context

Sprite Generator MVP は、魚の透過 PNG 画像 1 枚から自然言語指示で **固定テンプレートのピクセルアニメ（GIF + スプライトシート）** を半自動生成する Web サービス。以下の 6 capability を 1 つの Next.js アプリとして実装する:

- `image-upload` — 透過 PNG アップロード + プロンプト入力（≤ 512x512px, PNG w/alpha のみ）
- `nl-animation-parsing` — Anthropic Claude API (`claude-haiku-4-5`) による固定構造化
- `region-masking` — body/tail/mouth/fin のマスク編集 UI（自動 body 初期化 + 後処理補正）
- `template-animation-renderer` — 4 種テンプレート（swim_slow/turn/approach_food/eat）を 16f@8fps で同期生成、30s timeout
- `project-persistence` — source/mask/project.json/result.gif/spritesheet.png を Supabase Storage に保存
- `user-auth-billing` — Supabase Auth + フリーミアム制限（10 gen/月・5 save）+ Stripe 最小統合

現時点のリポジトリは空（init commit のみ）。ビルド基盤・DB schema・CI すべてゼロから構築する。MVP は同期生成前提で、ジョブキューは導入しない。

**ステークホルダー:** 開発者（yuki）単独、将来の有料ユーザー（個人クリエイター）。

## Goals / Non-Goals

**Goals:**

- 受け入れ条件（proposal §20 相当）を満たす動く MVP を 1 つの Next.js アプリとしてデプロイ可能にする
- `project.json` の `version=1` / `renderer_version=1` を **不変の再現性契約** として確立し、将来のマイグレーションの足場にする
- LLM 出力を `tool_use` + JSON schema で **型安全に強制** する（正規表現パースに依存しない）
- Anthropic / Supabase / Stripe の API キーを **サーバー側のみ** に保持する（クライアントバンドルに混入させない）
- 同期生成の 30 秒 budget を守れるよう、レンダラを CPU 効率よく実装（純 TS or Rust WASM 検討）

**Non-Goals:**

- 魚以外の entity_type 対応（fish 固定）
- 全自動部位推定（セマンティックセグメンテーション）
- 非同期ジョブキュー・ワーカープール（同期 serverless で完結）
- 高度なペイント機能（レイヤー合成、ブラシプリセット等）
- 複数 renderer_version の互換レイヤ（v1 固定、異バージョンは読み取り専用）
- マルチテナント・組織プラン
- 自動リトライ戦略（ユーザー手動で再試行）

## Decisions

### D1: フレームワークは Next.js (App Router) + TypeScript

- **採用:** Next.js 15+ App Router、TypeScript strict、React 19
- **理由:** proposal でフロントに Next.js 指定。App Router + Route Handlers で LLM/Renderer API をサーバー側に置きつつ、Supabase Auth helpers と統合しやすい。RSC でストレージ URL を signed URL として安全に渡せる。
- **代替案:** SvelteKit / Remix → Supabase Auth / Next.js エコシステムの厚さ（Stripe connector, Supabase SSR）を優先。

### D2: LLM 呼び出しは Anthropic SDK + `tool_use` 強制スキーマ

- **採用:** `@anthropic-ai/sdk`、`claude-haiku-4-5-20251001`、`tool_choice: {type: "tool", name: "emit_animation_spec"}`
- **理由:** `tool_use` は構造化出力を強制でき、パースエラーを排除できる。Haiku はコスト 1/3 でレイテンシも低い（haiku-4.5 はコスト最適）。Sonnet にフォールバックする必要はない（固定語彙なのでタスクは単純）。
- **代替案:**
  - JSON mode（OpenAI 類似）→ Anthropic SDK は tool_use のほうが schema 制約が厳密
  - free-form text + Zod parse → パースエラーのリスク
- **プロンプトキャッシュ:** システムプロンプト（固定語彙定義）に `cache_control: {type: "ephemeral"}` を付与し、呼び出しコストを 90% 削減（5 分 TTL を跨ぐときは再計算）。

### D3: レンダラは Node.js サーバー側で純 TS 実装（MVP）

- **採用:** `sharp` (libvips) で画像変形、`gifenc` で GIF 出力。Canvas API は node-canvas でフレーム合成。
- **理由:** 512x512 / 16f なら libvips で十分高速（1 フレーム < 100ms 見込み）。WASM 化は過剰。
- **アルゴリズム:**
  - マスク領域をパッチとして切り出し → アフィン変形（平行移動・回転・スケール）を時間関数で適用 → 元画像にアルファブレンド合成
  - swim_slow: tail を `sin(2πt)` で左右に ±amplitude 度回転
  - turn: tail の振幅を一時的に 2x に、body を 0.95-1.05 で縦軸スケール
  - approach_food: swim_slow + 水平方向 `translate((1-cos(πt))/2 * 5px)`
  - eat: approach_food 前半 + mouth を垂直軸スケール 1.0→0.3→1.0 で開閉
- **代替案:** Rust WASM → MVP には過剰、将来の renderer_version=2 で検討。

### D4: ストレージは Supabase Storage（private bucket）+ signed URL

- **採用:** bucket `projects` を private、読み取りは 1 時間有効な signed URL を Route Handler 経由で発行
- **理由:** public にすると他人の project を URL 推測で閲覧可能、再エンコード耐性ない。Supabase RLS policy でユーザー所有チェック可能。
- **パス設計:** `{user_id}/{project_id}/source.png`, `mask.png`, `result.gif`, `spritesheet.png`, `project.json`

### D5: DB schema（Supabase Postgres）

```sql
-- users は Supabase Auth が自動管理（auth.users）
-- アプリ専用メタは以下

-- All timestamp columns use `timestamptz`, which Postgres stores as UTC
-- internally regardless of session timezone. Defaults use `now()` (a
-- `timestamptz` value already normalized to UTC at storage). The read path
-- serializes every value through `.toISOString()` so the wire format is
-- always ISO8601 with trailing `Z`; no offset-style timestamps ever cross
-- the app boundary. Session-timezone-dependent expressions (`at time zone`
-- casts to naive `timestamp`, `date_trunc` without explicit UTC) are
-- prohibited in migrations.

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  plan text not null default 'free' check (plan in ('free','paid')),
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  prompt text not null,
  final_animation_type text not null check (final_animation_type in ('swim_slow','turn','approach_food','eat')),
  renderer_version int not null default 1,
  source_path text not null,
  mask_path text not null,
  project_json_path text not null,
  gif_path text,
  spritesheet_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_user_id_idx on projects (user_id, updated_at desc);

create table generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  project_id uuid references projects on delete set null,
  status text not null check (status in ('success','failed','timeout')),
  counted boolean not null default false,
  created_at timestamptz not null default now()
);
-- Use a plain (user_id, created_at) index so the predicate stays IMMUTABLE.
-- Monthly bucketing is computed in the query (e.g. WHERE created_at >= date_trunc('month', now())).
create index generations_user_created_idx on generations (user_id, created_at desc)
  where status = 'success' and counted = true;

create table plan_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  from_plan text not null,
  to_plan text not null,
  stripe_event_id text unique,
  occurred_at timestamptz not null default now()
);
```

RLS: すべてのテーブルで `user_id = auth.uid()` を強制。`plan_changes` は service role のみ INSERT（Stripe webhook）。

**UTC 正規化契約:** `timestamptz` 列は Postgres が常に UTC で内部格納する。`default now()` は UTC 値を返す（表示のみ session tz 依存）ため migration はこれで十分。アプリ層から明示値を挿入する場合は `new Date().toISOString()` (ISO8601 UTC、末尾 `Z` 固定) を渡す。`at time zone 'utc'` を `timestamptz` 列の default として使うと naive `timestamp` に変換されて型が崩れるため禁止する。

**月次集計の UTC 境界:** クォータ用の月次集計は、DB セッションのタイムゾーンに依存しない UTC 月境界で行う。`countSuccessGenerationsThisMonth(userId)` は次のいずれかで開始境界を決定する:
- サーバー側 TS で `const start = new Date(); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);` を計算し `.toISOString()` で `gte('created_at', start)` に渡す（MVP 採用）
- もしくは SQL 側で `date_trunc('month', now() at time zone 'utc')` を使用する

どちらの実装でも、ユーザー現地時刻が月末付近（例: JST 5/1 07:00 = UTC 4/30 22:00）でも UTC 月境界でリセットされる。テストで `process.env.TZ = 'Asia/Tokyo'` / `'America/Los_Angeles'` / `'UTC'` を切り替えて同一の開始境界 ISO 文字列が返ることを assert する。

### D6: クォータ検査は Route Handler 先頭で実行

- **採用:** 生成 API `/api/generate` は以下の順:
  1. auth check（未認証は 401）
  2. **isRegeneration 判定**: リクエストが既存 saved project (`project_id` 指定) を起点に作られた draft の再生成、もしくは既に成功生成済の draft 再実行なら `isRegeneration=true`。新規アップロード draft の初回成功生成のみ `isRegeneration=false`。判定は draft 行の `originating_project_id` フィールド (D6.1 参照) と `gif_path` 既存有無で行う。
  3. **生成クォータ** check: `isRegeneration=false` の場合のみ plan 別月次成功数上限を適用（Free: 10、Paid: 200。超過なら 402 + upgrade prompt）。`isRegeneration=true` のリクエストはクォータを **消費しない / 検査もしない**（proposal: 「再生成はカウントしない」）。
  4. LLM call（timeout 10s; 既に `llm_result` が draft に保存されているなら再呼び出しせず draft の `final_*` をそのまま使用）
  5. Renderer call（timeout 20s）
  6. Storage に **draft** アーティファクト（source/mask は既存、result.gif と spritesheet を `{user_id}/drafts/{draft_id}/` 配下に書き出し）
  7. `generations` に `status='success'` を insert: `counted = !isRegeneration`（初回成功のみ true）
  8. レスポンスに `draft_id` を返し、ユーザーが確認後に保存操作する
- **失敗時:** `status='failed'` / `timeout` を `counted=false` で insert（監査用、クォータ非加算）。draft アーティファクトは書き出し途中でも **直ちに削除**、`projects` 行は作られないため副作用ゼロ。
- **保存クォータ**は保存操作時のみ検査（D6.1 参照）。生成段階では常に素通し。
- **race condition:** 同時リクエストで上限+1 件成功するリスクは、`count() + insert` を advisory lock でシリアライズ（`isRegeneration=false` のときのみロック取得）。

### D6.1: Draft / 保存ライフサイクル（saved-project vs draft の明確化）

proposal の「失敗分は保存されない / 再生成はカウントしない / 保存 5 件上限」を守るため、**project は明示的な保存操作でのみ作成される**。

- **Upload 段階（`/api/upload`）:**
  - 認証済みユーザーのみ、PNG と prompt を受け取り `draft_id` (uuid) を採番
  - `source.png` を `{user_id}/drafts/{draft_id}/source.png` に書き込む（Storage）
  - DB には `drafts` 行を INSERT（`originating_project_id=null`）
  - **保存クォータは検査しない**（upload は保存ではない）
  - **同期的に LLM parse を実行** (`parsePrompt(prompt, source)`、D2 と同一クライアント、10s timeout)。成功時のみ draft 行に `llm_result`、`final_animation_type = llm_result.animation_type`、`final_params = llm_result.params` を seed（D9.1 の固定スキーマ）して mask ページにリダイレクト。
  - **schema-invalid な LLM 出力 / timeout / upstream エラー時は、parsing spec に従い拒否する**: 直前に書いた `source.png` を Storage から削除し、`drafts` 行も削除し、422 / 504 / 502 を返してユーザーを `/upload` に留める。`generations` には記録しない（生成ではない）。MVP では「LLM 解析失敗のまま手動入力で進む」フローはサポートしない（spec 契約: 「invalid LLM output は reject、project data は作成しない」）。
- **Mask 保存（`/api/mask/save`）:** マスクも `{user_id}/drafts/{draft_id}/mask.png` に書き込む。`final_animation_type` / `final_params` の更新もここで保存（D9.1 固定スキーマで Zod 検証）。draft 行を更新するのみ、`projects` には触れない。
- **生成（`/api/generate`）:** D6 の通り draft の下に `result.gif` / `spritesheet.png` / `project.json` を書き出す。`projects` 行は作らない。draft の `llm_result` が既に存在するため、再度 LLM を呼ばずに `final_*` で Renderer を実行する。
- **保存操作（`POST /api/projects/save`、mode = `new` | `overwrite` | `duplicate`）:**
  1. auth check
  2. **保存クォータ check**（`countSavedProjects(userId) >= limit` なら 402。mode='overwrite' の時は自分の既存 project への上書きなので加算しない）
  3. mode='new': draft アーティファクト (source/mask/gif/spritesheet) を `{user_id}/{project_id}/` に **コピー or 移動**、その後 **`project.json` を最終 `source_image_path` / `mask_image_path` / `outputs.gif_path` / `outputs.spritesheet_path`、`created_at = now()`、`updated_at = now()`、`renderer_version`、`llm_result`、`final_animation_type`、`final_params` で再生成して同パスに書き込む**、`projects` 行 INSERT
  4. mode='overwrite': 既存 `projects` 行を参照し、アーティファクト (source/mask/gif/spritesheet) を差し替え、**既存 `project_id` パス配下に `project.json` を再生成して上書き** (`created_at` は保持、`updated_at = now()`)、`projects.updated_at` 更新
  5. mode='duplicate': 既存 project を読み、新 `project_id` で全アーティファクトコピー、**新パスに `project.json` を再生成** (`source_image_path` 等を新 project_id 配下に書き換え、`created_at = now()`、`updated_at = now()`)
  6. 成功時、draft が使われていたなら draft 行と Storage draft 配下を **削除**
- **`project.json` 生成の責務:** `project.json` は **保存操作の中でのみ最終形が確定**する。draft 配下の `project.json` (生成時に書かれるもの) は中間スナップショットに過ぎず、保存時に必ず上記ルールで再生成して上書きする。これによりパス・タイムスタンプ・mode 別の意味論が常に整合する。`src/server/projects/serialize.ts` に唯一のシリアライザを置き、生成時 (draft) と保存時 (final) の両方で参照する。
- **既存成果物の editor 復元契約:** `open-in-editor` で saved project から hydrate した draft は `gif_path` / `spritesheet_path` を保持しているので、マスク編集画面は **プレビューセクションに既存の GIF / spritesheet を signed URL 経由で表示**する。リロード時のフローは:
  1. `GET /drafts/[draft_id]/mask` サーバーコンポーネントが `drafts` 行から `source_path` に加えて `gif_path` / `spritesheet_path` / `originating_project_id` を読み込む
  2. 画像系は全て 1 時間の signed URL を発行して client に渡す
  3. MaskEditor は source / mask を canvas に描画するほか、`gif_path` が非 null の場合「前回の生成結果」セクションを表示（GIF プレビュー + spritesheet サムネ + renderer_version バッジ）
  4. ユーザーが mask を編集すると「前回結果は再生成まで古い状態のまま」である旨の薄い注意を表示するが、再生成を強制しない（確認用に残す）
  この復元はマスクのみ変更して再生成する典型シナリオで前回出力を即座に参照できることを保証する。draft 固有のマスクがまだ存在しない新規アップロード直後はこのセクションは表示しない。

- **`project.json` の top-level スキーマ (project-persistence spec と一致):** トップレベルキーは **正確に** `version` / `entity_type` / `source_image_path` / `mask_image_path` / `prompt` / `llm_result` / `final_animation_type` / `final_params` / `region_palette` / `outputs` / `renderer_version` / `created_at` / `updated_at` のみ。アーティファクトのパスは画像系 (`source_image_path` / `mask_image_path`) と生成物 (`outputs: { gif_path, spritesheet_path }`) で分離する。DB の `projects` テーブルの列名 (`source_path` / `mask_path` / `gif_path` / `spritesheet_path`) は内部表現に過ぎず、シリアライザは必ず spec の top-level キーに変換する。
- **Draft クリーンアップ / 保持:**
  - ユーザーが保存せずに離脱した draft は **24 時間後に cron（`supabase/functions/cleanup-drafts`）で削除**
  - 生成失敗（タイムアウト含む）時は `/api/generate` 内で draft の result.gif / spritesheet / project.json を **即時削除**（source / mask は残してユーザーが再試行できる）
  - ユーザー削除時は drafts もカスケード削除

**追加 DB スキーマ:**

```sql
create table drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  prompt text not null,
  final_animation_type text check (final_animation_type in ('swim_slow','turn','approach_food','eat')),
  final_params jsonb,
  llm_result jsonb,
  source_path text not null,
  mask_path text,
  gif_path text,
  spritesheet_path text,
  project_json_path text,
  originating_project_id uuid references projects on delete set null, -- non-null when draft was hydrated from a saved project (regenerate / edit flow)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index drafts_user_id_idx on drafts (user_id, updated_at desc);
-- Cleanup query filters `updated_at < now() - interval '24 hours'` at runtime;
-- the index uses an IMMUTABLE expression to stay deployable.
create index drafts_updated_at_idx on drafts (updated_at);
```

RLS は projects と同じく `user_id = auth.uid()` を強制。

### D7: 認証フロー

- **採用:** Supabase Auth UI を使わず、カスタム login ページ（email+password）+ Google OAuth。`@supabase/ssr` でサーバー側セッション管理。
- **理由:** Supabase Auth UI はブランディング困難、カスタムで Next.js middleware と自然に統合。
- **middleware.ts:** public path は exactly `/`, `/login`, `/signup`, `/auth/callback` の 4 つ、public API は `/api/public/*` と `/api/stripe/webhook` のみ。**その他すべての経路**（`/upload`, `/projects`, `/projects/[id]`, `/drafts/[draft_id]/mask`, `/drafts/[draft_id]/preview`, `/billing`, `/billing/success`, `/billing/cancel`, その他 `/api/*` 非 public）は未認証なら `/login?next=<原 path>` に redirect、`/api/*` は 401 JSON を返す。matcher は `_next/*` / 静的ファイル拡張子を除外する単一パターンで、将来追加されるページも既定で保護される。Stripe Checkout からの戻り URL (`/billing/success` / `/billing/cancel`) も **認証済みユーザー前提**で、未認証の場合は `/login?next=/billing/...` を経由してログイン後に元の URL へ戻す。

### D8: Stripe 統合

- **採用:** Stripe Checkout (hosted) + Webhook。Product は「Paid Monthly」1 種のみ、単価は MVP で $9/月 とする（変更容易）。
- **プラン別クォータ（確定値）:**
  - Free: 生成成功 **10 / 月**、保存 **5 件**、商用不可
  - Paid: 生成成功 **200 / 月**、保存 **100 件**、商用可
  - これらの値は `src/lib/quota/limits.ts` に `PLAN_LIMITS = { free: { generationsPerMonth: 10, savedProjects: 5 }, paid: { generationsPerMonth: 200, savedProjects: 100 } }` として一元定義し、クォータヘルパー・Billing UI・webhook 後の UI メッセージ・受け入れテストから参照する。
- **Webhook events:**
  - `checkout.session.completed` → `profiles.plan='paid'`, `plan_changes` insert
  - `customer.subscription.deleted` → `profiles.plan='free'` (period end)
- **Webhook security:** `stripe.webhooks.constructEvent` で署名検証、raw body を Route Handler で受ける。

### D9: マスク編集 UI は HTML Canvas + Zustand

- **採用:** React + Canvas 2D API で描画。状態は Zustand store（source, masks[4], currentLabel, undoStack, **llmResult, finalAnimationType, finalParams**）。Undo は immer patch stack で実装。
- **マスク表現:** 4 つの bitmap layer（各 body/tail/mouth/fin を別々の Uint8Array）、保存時に `mask.png` へ palette エンコード（R,G,B = region color）。
- **補正フィルタ:** morphological opening (erode + dilate 1px) + fill holes via flood fill。純 JS 実装で 512x512 は数十 ms。

### D9.1: final_params の編集と永続化

proposal は `final_params` を `llm_result` と **分離して保存**し、再読み込み時に復元、再生成時には `final_params` で描画することを要求する。UI でも params を人が上書きできる必要がある。

- **`final_params` の固定スキーマ（proposal 契約と一致）:**
  - `speed`: enum `'slow' | 'medium'`
  - `amplitude`: enum `'small' | 'medium'`
  - `emphasis`: enum `'none' | 'tail' | 'mouth' | 'fin'`
  - `loop`: boolean
  - これは LLM 出力 (`llm_result.params`) と同一スキーマ。永続化される `final_params` は **このボキャブラリのまま** であり、数値スライダーや数値ループに変換しない。
- **パネル構成:** マスク編集ページ下部に「アニメーションパラメータ」パネルを置き、以下を編集:
  - `animation_type`（ドロップダウン / LLM 推薦を初期値に上書き可）
  - `speed`（segmented control: `slow` / `medium`）
  - `amplitude`（segmented control: `small` / `medium`）
  - `emphasis`（segmented control: `none` / `tail` / `mouth` / `fin`）
  - `loop`（toggle: on/off。`final_params.loop` は真の boolean として扱い、LLM やリロードから渡される `false` を保持する。MVP は新規生成時の初期値を `true` にし、UI トグルを read-only として表示するが、内部状態と永続化は boolean を保ったままで `true` に強制変換しない。Renderer は `loop=false` を受け取った場合に GIF を 1 回のみ再生する形でレンダリングする）
- **状態モデル:**
  - `llmResult`: LLM から返ってきた生データ。**読み取り専用で常に保持**し以後変更しない。
  - `finalAnimationType`: ユーザーが最終決定した値（初期値 = `llmResult.animation_type`）
  - `finalParams`: ユーザー編集可能な params（初期値 = `llmResult.params` の deep copy）。immutable update で更新。**型は上記の固定 enum/boolean スキーマを保つ**。
- **レンダラ内部マッピング:** Renderer は受け取った enum/boolean を内部の数値係数に変換する（例: `speed: 'slow' → 0.7x`, `'medium' → 1.0x`、`amplitude: 'small' → ±5°`, `'medium' → ±12°`、`emphasis` で対応部位の変形量を 1.5x 強調、`loop=true → GIF loop 0(無限)` / `false → 1`）。マッピング表は `src/server/renderer/params.ts` に一元定義。**永続化される `final_params` は数値化されない**。
- **API:**
  - `POST /api/mask/save` は `final_animation_type` と `final_params`（固定スキーマ）も受け取り draft に保存
  - `POST /api/generate` は draft の `final_animation_type` / `final_params` を Renderer に渡す（llm_result の params は渡さない）
- **永続化:** 保存時、`project.json` は `llm_result`（LLM 原本）と `final_params` / `final_animation_type`（ユーザー確定値）を別キーで保存。両者は同じ固定スキーマで表現される。
- **タイムスタンプ UTC 契約:** `project.json` の `created_at` / `updated_at` は **必ず ISO8601 UTC 文字列**（例: `"2026-04-14T08:50:00.000Z"`、末尾 `Z` 固定）とする。シリアライザは `new Date().toISOString()` を使用し、`Intl` / ローカルタイムゾーンに依存する関数（`toLocaleString` 等）は利用しない。Zod スキーマでは `z.string().datetime({ offset: false })` で `Z` 必須を検証する（オフセット付き `+09:00` 形式は拒否）。ユニットテストで `process.env.TZ` を `'Asia/Tokyo'` / `'UTC'` に切り替えても同一出力になることを assert する。
- **レンダラ契約:** Renderer は `final_animation_type` と `final_params` のみを入力として受け取り、`llm_result` は参照しない。Renderer 入口で Zod により固定スキーマを再検証する。

### D10: 入力バリデーション

- **採用:** クライアント（即時 UX）+ サーバー（信頼境界）で二重検証。
- **チェック項目:**
  - MIME type `image/png`（magic bytes 検証）
  - サイズ ≤ 512x512（`sharp().metadata()` でサーバー確認）
  - alpha channel 存在 + 透明ピクセル 1 個以上（`sharp().stats()` で alpha min 確認）
- **ファイルサイズ上限:** 2MB（クライアント弾き + Next.js Route Handler の `bodySizeLimit: '2mb'`）

### D11: デプロイは Vercel

- **採用:** Vercel (Next.js 公式ホスト) + Vercel KV 不使用（Supabase DB で十分）
- **環境変数:** `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_SITE_URL`
- **Route Handler 設定:** `export const maxDuration = 30` で 30 秒 timeout を明示（Vercel Hobby 10s 制限に注意 — Pro プラン必須）。

### D12: テストと品質ゲート

- **ユニット:** Vitest、レンダラ各テンプレの決定性テスト（同入力→ハッシュ一致）
- **統合:** Playwright で upload→mask→generate→save→reload のゴールデンパス
- **契約テスト:** Zod schema で `project.json` をバリデーション、`version`/`renderer_version` の不整合テスト
- **カバレッジ目標:** 80%（core/ は 90%）

## Risks / Trade-offs

- **[Risk] Vercel Hobby の 10s timeout** → Pro プラン（$20/月）必須。MVP 開始時点で Pro 加入、または Cloudflare Workers への移行オプション（WASM 化とセット）。
- **[Risk] Anthropic API レイテンシ** → haiku-4.5 でも 95 percentile 2-3s 程度。レンダラ 20s と合わせて 30s ギリギリ。レンダラ先行開始は不可能（LLM 結果がパラメータを決めるため）。Mitigation: レンダラを 15s 内に収めるようベンチ、超過時は事前に budget error を返す。
- **[Risk] Stripe webhook の in-flight race** → checkout 成功直後に生成すると plan 更新前の可能性。Mitigation: UI で明示的に「支払いを反映中」を数秒表示、backend は次のリクエストで最新 plan を参照。
- **[Risk] マスクの微小誤差による fallback 誤発動** → 空マスク判定は **opaque pixel count == 0 の厳密ゼロ** を基準にする（proposal の「空マスク」契約と整合）。小さな mouth / fin を誤って degraded と扱わない。別途「小さすぎる領域」に対する **非ブロッキング advisory warning**（閾値 < 10 px）を UI に表示するが、fallback や renderer の挙動は変更しない。
- **[Risk] Supabase Storage の帯域コスト** → signed URL は 1h 有効、frontend でキャッシュ。Free tier で 5 save / user なので MVP では問題にならない見込み。
- **[Risk] 異なる renderer_version の project を誤って regenerate** → UI の regenerate ボタンを disabled にし、API 側でも version mismatch を 409 で拒否（二重防御）。
- **[Trade-off] Canvas UI の decision coverage** → モバイル（タッチ）は MVP 対象外、desktop マウス操作前提で実装。スマホは閲覧のみ。
- **[Trade-off] LLM provider lock-in** → Anthropic 固定。将来 OpenAI 等を追加するなら `src/server/llm/provider.ts` に interface を切る前提設計だが、MVP では直呼び。

## Migration Plan

新規プロジェクトのため既存データ移行なし。

**デプロイ手順:**

1. Supabase プロジェクト作成、上記 schema を `supabase/migrations/0001_init.sql` で適用
2. RLS policy を `0002_rls.sql` で適用
3. Storage bucket `projects` を private で作成
4. Vercel プロジェクト作成、環境変数設定
5. Stripe Product/Price 作成、Webhook endpoint `https://<site>/api/stripe/webhook` を登録
6. 初回デプロイ、Playwright ゴールデンパス E2E を本番に対して実行
7. Anthropic API の concurrency limit を確認（初期は 5 rpm で十分）

**ロールバック:**

- Vercel の previous deployment に即時切替（1 クリック）
- DB migration は forward-only だが、MVP 段階では destructive 変更前に `pg_dump` スナップショット

## Open Questions

- Stripe Price ID は本番・テスト環境で別。環境変数化（`STRIPE_PRICE_ID_MONTHLY`）するか、プラン定義をハードコードするか — MVP は env 化推奨。
- ~~Paid プランの具体数値~~ → **D8 で確定（生成 200/月、保存 100 件、商用可）**。
- ユーザー退会フローは MVP に含めるか（Supabase Auth は delete API あり、Storage と projects を cascade delete する必要）。→ tasks.md で含める前提。
- Anthropic API key のレート制御は Supabase Edge Function で実装するか Vercel で直接か → Vercel Route Handler で十分、将来分離可能。
