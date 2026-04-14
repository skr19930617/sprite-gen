# Approval Summary: sprite-generator-mvp

**Generated**: 2026-04-14T09:15:00Z
**Branch**: sprite-generator-mvp
**Status**: ✅ No unresolved high

## What Changed

128 files changed, 21705 insertions(+)

Key areas:
- `src/app/` — Next.js App Router pages and API routes (upload, mask editor, generate, projects, billing, auth)
- `src/server/` — LLM integration (Anthropic Claude), renderer (sharp+gifenc), project serialization, storage
- `src/lib/` — Supabase clients, quota/rate-limit helpers, PNG validation, mask utilities
- `src/components/` — QuotaBadge shared component
- `supabase/migrations/` — 3 migrations (init schema, RLS policies, storage bucket)
- `tests/` — Unit tests (14 files), integration tests (4 files), E2E tests (3 files)
- `.github/workflows/ci.yml` — CI pipeline
- `openspec/` — Spec artifacts (6 specs, design, tasks, review ledger)

## Files Touched

126 new files, 2 modified files (CLAUDE.md, README.md).

Major new directories:
- `src/app/api/` (generate, llm/parse, mask/save, projects/save, projects/[id]/open-in-editor, storage, stripe, upload)
- `src/app/` pages (login, signup, billing, drafts/[draft_id]/mask, drafts/[draft_id]/preview, projects, projects/[id], upload)
- `src/server/renderer/` (decode-mask, encode, index, params, templates, transform, types)
- `tests/unit/` (14 test files), `tests/integration/` (4 test files), `tests/e2e/` (3 specs)
- `supabase/migrations/` (0001_init, 0002_rls, 0003_storage)

## Review Loop Summary

### Design Review

| Metric             | Count |
|--------------------|-------|
| Initial high       | 2     |
| Resolved high      | 12    |
| Unresolved high    | 0     |
| New high (later)   | 10    |
| Total rounds       | 4     |

Open medium findings (3): R4-F15 (UTC handling), R4-F16 (editor output restore), R4-F17 (billing route auth)

### Impl Review

⚠️ Impl review skipped (force-approved by user — changes too large for automated review)

## Proposal Coverage

Acceptance criteria from proposal §20:

| # | Criterion (summary) | Covered? | Mapped Files |
|---|---------------------|----------|--------------|
| 1 | 透過PNGの魚画像をアップロードできる | Yes | src/app/upload/, src/app/api/upload/route.ts, src/lib/image/png-validation.ts, src/server/image/png-validate-server.ts |
| 2 | 自然言語からanimation_typeと必要部位を提示できる | Yes | src/server/llm/parse-prompt.ts, src/server/llm/schema.ts, src/app/api/llm/parse/route.ts |
| 3 | body自動初期化 + tail/mouth/fin指定ができる | Yes | src/app/drafts/[draft_id]/mask/MaskEditor.tsx, src/lib/mask/ |
| 4 | マスク補正が動く | Yes | src/lib/mask/correction.ts, tests/unit/mask-correction.test.ts |
| 5 | 少なくとも4種の固定アニメが生成できる | Yes | src/server/renderer/templates.ts (swim_slow, turn, approach_food, eat) |
| 6 | GIFが出力できる | Yes | src/server/renderer/encode.ts (gifenc) |
| 7 | スプライトシートが出力できる | Yes | src/server/renderer/encode.ts (spritesheet composer) |
| 8 | projectを保存・再編集できる | Yes | src/app/api/projects/save/route.ts, src/app/api/projects/[id]/open-in-editor/route.ts, src/server/projects/ |

**Coverage Rate**: 8/8 (100%)

## Remaining Risks

### Open Review Findings (medium)
- R4-F15: UTC handling is still not pinned for quota resets and saved timestamps (severity: medium)
- R4-F16: Reloading a saved project still does not explicitly restore prior outputs into the editor (severity: medium)
- R4-F17: Billing return pages are left outside the authenticated-route contract (severity: medium)

### Notes
- Impl review was skipped — no automated code-level review was performed
- External dependencies not yet provisioned: Supabase project (2.1), Stripe products (10.2)
- Security review pass (12.8) deferred until Supabase project is provisioned

## Human Checkpoints

- [ ] Supabase プロジェクトを作成し、migrations を適用して RLS が正しく動作することを確認する
- [ ] Stripe Product/Price を作成し、webhook endpoint が signature verification を通過することを確認する
- [ ] ローカルで upload → mask → generate → save → reload → regenerate のフルフローを手動テストする
- [ ] `/billing/success` と `/billing/cancel` が認証必須であることをブラウザで確認する（R4-F17）
- [ ] `process.env.TZ` が異なる環境で月次クォータリセットが UTC 基準であることを確認する（R4-F15）
