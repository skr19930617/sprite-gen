# sprite-gen

透過PNGの魚画像と自然言語プロンプトから、ピクセルアニメーションGIF / スプライトシートを生成する Next.js 製 MVP です。

## 概要

このアプリは、魚の立ち絵 1 枚から「ゆっくり泳ぐ」「餌に近づく」「口を開けて食べる」といったアニメーションを半自動で生成するための Web アプリです。

基本フローは次の通りです。

1. `/upload` で透過PNG画像と自然言語プロンプトを入力
2. Anthropic Claude がプロンプトを固定スキーマに構造化
3. `/drafts/[draft_id]/mask` で部位マスクを調整
4. テンプレート Renderer が 16 フレーム / 8fps のアニメーションを生成
5. GIF / スプライトシート / `project.json` を保存して再編集

MVP は **魚専用・固定テンプレート型・同期生成** に絞っており、再現性のある `project.json` を中心に据えています。

## 現在できること

- 透過PNGアップロードとクライアント / サーバー両側の入力バリデーション
- 自然言語プロンプトの構造化解析
  - `entity_type`
  - `animation_type`
  - `required_regions`
  - `optional_regions`
  - `params`
- 4 ラベルのマスク編集 UI
  - `body`
  - `tail`
  - `mouth`
  - `fin`
- 編集機能
  - ペン
  - 消しゴム
  - 塗りつぶし
  - ズーム
  - Undo
  - 補正フィルタ
- 固定テンプレートによる 1 アニメーション種別ずつの生成
  - `swim_slow`
  - `turn`
  - `approach_food`
  - `eat`
- GIF とスプライトシートPNGの生成
- Supabase による draft / project 永続化
- 保存済み project の一覧・詳細・再編集・再生成
- Supabase Auth による認証
- Stripe による無料 / 有料プラン基盤
- 無料プラン制限
  - 月 10 回まで生成成功
  - 保存 5 件まで

## 実装状況

OpenSpec 上では、アプリ本体の実装はほぼ揃っています。

- Scaffold / Auth / Upload / LLM / Mask UI / Renderer / Generate / Persistence / Billing / Quota / Security の主要項目は概ね完了
- 現在フェーズ: `design-fix-review`
- Round: `4`
- Open High Findings: `0`
- Actionable Findings: `3`

要するに、**コア機能は実装済みで、残りは一部テスト補強・UI 仕上げ・外部サービス構築・デプロイ作業が中心** です。

参照:

- [openspec/changes/sprite-generator-mvp/proposal.md](openspec/changes/sprite-generator-mvp/proposal.md)
- [openspec/changes/sprite-generator-mvp/tasks.md](openspec/changes/sprite-generator-mvp/tasks.md)
- [openspec/changes/sprite-generator-mvp/current-phase.md](openspec/changes/sprite-generator-mvp/current-phase.md)

## 未完了・残作業

主な残タスクは次の通りです。

- Supabase の開発 / 本番プロジェクト作成と migration のクリーン適用確認
- Stripe の Product / Price 作成
- `buildProjectJson` と UTC 月境界に関する追加ユニットテスト
- `open-in-editor` 後のマスク画面で前回生成結果を見せる UI 補強
- Playwright の一部補強
- セキュリティレビュー最終実施
- Vercel / 環境変数 / Webhook を含むデプロイ作業
- 最終受け入れ確認

そのため、現状は **MVP 実装済みだが運用準備は未完了** という位置づけです。

## 技術スタック

- Next.js 15 (App Router)
- React 19
- TypeScript
- Supabase
  - Auth
  - Postgres
  - Storage
- Anthropic SDK
- Stripe
- sharp
- gifenc
- Zustand
- Immer
- Vitest
- Playwright

要件:

- Node.js 20 以上

## ローカルセットアップ

### 1. 依存関係をインストール

```bash
npm install
```

### 2. 環境変数を用意

`.env.example` を元に `.env.local` を作成します。

```bash
cp .env.example .env.local
```

その後、Anthropic / Supabase / Stripe の値を設定してください。

### 3. 開発サーバーを起動

```bash
npm run dev
```

デフォルトでは Next.js の開発サーバーが起動します。

### 4. 必要に応じて検証を実行

```bash
npm run typecheck
npm run lint
npm test
```

E2E や live integration は外部サービスの準備が必要です。

## 環境変数

`.env.example` にある主な変数は次の通りです。

| 変数                                 | 用途                                         |
| ------------------------------------ | -------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`               | サイトURL。OAuth / Stripe リダイレクトで使用 |
| `ANTHROPIC_API_KEY`                  | LLM 解析用のサーバー側キー                   |
| `NEXT_PUBLIC_SUPABASE_URL`           | Supabase プロジェクトURL                     |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`      | Supabase 公開キー                            |
| `SUPABASE_SERVICE_ROLE_KEY`          | サーバー側の管理操作用キー                   |
| `STRIPE_SECRET_KEY`                  | Stripe API のサーバー側キー                  |
| `STRIPE_WEBHOOK_SECRET`              | Stripe Webhook 検証用シークレット            |
| `STRIPE_PRICE_ID_MONTHLY`            | 月額プランの Price ID                        |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe 公開キー                              |

注意:

- `SUPABASE_SERVICE_ROLE_KEY`、`STRIPE_SECRET_KEY`、`ANTHROPIC_API_KEY` はクライアントへ露出しない前提です
- 開発環境と本番環境で必ず分けて設定してください

## 主な画面・ルート

### ページ

- `/` - ランディングページ
- `/login` - ログイン
- `/signup` - サインアップ
- `/upload` - 画像アップロードとプロンプト入力
- `/drafts/[draft_id]/mask` - マスク編集
- `/projects` - 保存済みプロジェクト一覧
- `/projects/[id]` - プロジェクト詳細 / 再生成 / ダウンロード
- `/billing` - プランと利用状況
- `/billing/success` - Stripe 購入成功後の戻り先
- `/billing/cancel` - Stripe 購入キャンセル後の戻り先

### API

- `/api/upload`
- `/api/llm/parse`
- `/api/mask/save`
- `/api/generate`
- `/api/projects/save`
- `/api/projects/[id]/open-in-editor`
- `/api/stripe/checkout`
- `/api/stripe/webhook`

### 認証保護

公開ルートは主に `/`、`/login`、`/signup`、`/auth/callback` です。その他の主要画面と非公開 API は認証前提です。

## テスト・検証コマンド

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run typecheck
npm run format
npm run format:check
npm test
npm run test:watch
npm run test:coverage
npm run test:e2e
```

補足:

- 一部 integration test は外部サービス用の環境変数と実行フラグが必要です
- Playwright はローカルの開発サーバーを自動起動する設定です
- live Anthropic / live Supabase / Stripe フロー検証は手動準備が必要です

## 開発フロー

このリポジトリでは、OpenSpec を仕様と進捗の基準にしています。

1. まず proposal で仕様を確認
2. tasks で未完了タスクと受け入れ条件を確認
3. 実装または修正
4. `format:check` / `lint` / `typecheck` / `test` を実行
5. 必要なら `test:e2e` や live integration を実行
6. OpenSpec の状態を更新

主に確認するファイル:

- [openspec/changes/sprite-generator-mvp/proposal.md](openspec/changes/sprite-generator-mvp/proposal.md)
- [openspec/changes/sprite-generator-mvp/tasks.md](openspec/changes/sprite-generator-mvp/tasks.md)
- [openspec/changes/sprite-generator-mvp/current-phase.md](openspec/changes/sprite-generator-mvp/current-phase.md)

README は実装の入り口、OpenSpec は仕様の正本、という位置づけです。

## 既知の制約・注意点

- 魚画像専用の MVP です
- 入力は透過PNGのみです
- 入力制約は基本的に 512x512px 以下、2MB 以下です
- 1 回の生成リクエストで扱う `animation_type` は 1 つだけです
- Renderer は `renderer_version = 1` 前提です
- version 不一致の project は再生成を制限する場合があります
- 非同期ジョブ基盤はなく、生成は同期処理ベースです
- 失敗やタイムアウト時は生成回数に含めない前提です
- 魚以外、複数個体、高度な自動部位推定、動画入力は MVP 対象外です
