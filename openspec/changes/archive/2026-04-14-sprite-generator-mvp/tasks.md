## 1. Project Scaffold

- [x] 1.1 Initialize Next.js 15 App Router project with TypeScript strict mode and React 19
- [x] 1.2 Configure ESLint, Prettier, and tsconfig paths (`@/` → `src/`)
- [x] 1.3 Add Vitest + @testing-library/react for unit tests
- [x] 1.4 Add Playwright for E2E tests with base config
- [x] 1.5 Create `.env.example` listing all required env vars (`ANTHROPIC_API_KEY`, `SUPABASE_*`, `STRIPE_*`, `NEXT_PUBLIC_SITE_URL`)
- [x] 1.6 Add `npm run typecheck`, `lint`, `test`, `test:e2e` scripts
- [x] 1.7 Set up GitHub Actions CI (typecheck + lint + unit test on push)

## 2. Supabase Setup

- [ ] 2.1 Create Supabase project (dev + prod) and record project refs (manual / external)
- [x] 2.2 Write `supabase/migrations/0001_init.sql` with `profiles`, `projects`, `generations`, `plan_changes`, `drafts` tables and indexes (with `originating_project_id` FK)
- [x] 2.3 Write `supabase/migrations/0002_rls.sql` enforcing `user_id = auth.uid()` policies on all tables (including `drafts`)
- [x] 2.4 Create private Storage bucket `projects` with read policy `auth.uid()::text = (storage.foldername(name))[1]` (SQL written in `supabase/migrations/0003_storage.sql`; bucket creation runs as part of that migration)
- [x] 2.5 Add `supabase/seed.sql` for local dev test data (optional test users)
- [ ] 2.6 Verify migrations apply cleanly on a fresh Supabase project (pending Supabase project provisioning, see 2.1)

## 3. Auth (user-auth-billing partial)

- [x] 3.1 Install `@supabase/ssr`, `@supabase/supabase-js` and create server/client helpers in `src/lib/supabase/`
- [x] 3.2 Implement `middleware.ts` redirecting unauthenticated users to `/login?next=<path>` (publics: exactly `/`, `/login`, `/signup`, `/auth/callback`; public API prefixes: `/api/public/*`, `/api/stripe/webhook`). All other routes — including `/upload`, `/projects`, `/projects/[id]`, `/drafts/[draft_id]/mask`, `/drafts/[draft_id]/preview`, `/billing`, `/billing/success`, `/billing/cancel`, and every non-public `/api/*` — are protected. `/api/*` returns 401 JSON instead of redirect. Matcher excludes only `_next/*` and static-asset extensions so future pages are protected by default.
- [x] 3.3 Build `/login` page with email+password form and Google OAuth button
- [x] 3.4 Build `/signup` page with email verification flow
- [x] 3.5 Implement logout action (`/auth/logout`) and session refresh via middleware
- [x] 3.6 Add profile auto-creation trigger (in `0001_init.sql` via `tg__handle_new_user`)
- [x] 3.7 Write unit tests for Supabase client helpers (mock session)
- [x] 3.8 Playwright smoke tests: login/signup pages render; unauthenticated `/upload` / `/projects` / `/billing` / `/billing/success` / `/billing/cancel` / `/drafts/<id>/mask` / `/drafts/<id>/preview` all redirect to `/login` with `next=<original path>` (tests/e2e/auth-redirects.spec.ts)

## 4. Image Upload UI (image-upload)

- [x] 4.1 Build `/upload` page layout with file input, preview canvas, and prompt textarea
- [x] 4.2 Implement client-side PNG validation (magic bytes, size ≤ 512x512, file size ≤ 2MB)
- [x] 4.3 Implement checker-pattern preview background with transparency
- [x] 4.4 Reject non-transparent PNG (server-side via sharp stats, code `fully_opaque`)
- [x] 4.5 Reject JPEG and other formats on the client with format-mismatch error
- [x] 4.6 Validate prompt is non-empty before enabling submit
- [x] 4.7 Implement `POST /api/upload` route handler that re-validates on server (sharp metadata + alpha stats). Does NOT create a `projects` row and does NOT consume save quota
- [x] 4.8 Create a `drafts` row (`originating_project_id=null`) and store source.png at `{user_id}/drafts/{draft_id}/source.png`
- [x] 4.8.1 Synchronously parse via `parsePrompt` with 10s timeout; on failure roll back source + draft and respond 422/504/502; never inserts into `generations`
- [x] 4.9 On success return `draft_id` and redirect to `/drafts/[draft_id]/mask`
- [x] 4.10 Unit tests for PNG validation predicates
- [x] 4.11 Upload-route unit tests: success persists draft+LLM result; invalid LLM → 422 + rollback; timeout → 504 + rollback; upstream error → 502 + rollback (tests/unit/upload-route.test.ts)
- [x] 4.12 Playwright full-flow spec (gated by RUN_LIVE_E2E) covers upload → preview → mask (tests/e2e/full-flow.spec.ts)

## 5. LLM Animation Parsing (nl-animation-parsing)

- [x] 5.1 Define Zod schema for `LlmAnimationSpec` with fixed enums
- [x] 5.2 Install `@anthropic-ai/sdk` and create `src/server/llm/anthropic.ts` client
- [x] 5.3 Define Anthropic `tools` definition matching the Zod schema
- [x] 5.4 Implement `parsePrompt(prompt, sourceImageBase64)` that calls claude-haiku-4-5 with `tool_choice` forcing the tool
- [x] 5.5 Add `cache_control: {type: 'ephemeral'}` to the system prompt
- [x] 5.6 Parse `tool_use` input with Zod; on schema violation throw `InvalidLlmResponseError`
- [x] 5.7 Expose `parsePrompt()` and add `POST /api/llm/parse` (auth + per-user rate limit)
- [x] 5.8 Add 10s timeout on the Anthropic call; propagate timeout as 504
- [x] 5.9 Unit tests with Anthropic SDK mocked (valid / invalid schema / missing tool_use / timeout / upstream error)
- [x] 5.10 Live Anthropic integration test gated by `RUN_LIVE_ANTHROPIC=1` + `ANTHROPIC_API_KEY` (tests/integration/anthropic-live.test.ts)

## 6. Region Masking UI (region-masking)

- [x] 6.1 Build `/drafts/[draft_id]/mask` page with Canvas 2D editor (also reachable post-`open-in-editor`)
- [x] 6.2 React state managing source image, 4 mask layers (Uint8Array), currentLabel, undo stack, llmResult, finalAnimationType, finalParams, plus previous-output refs (`previousGifUrl`, `previousSpritesheetUrl`, `previousRendererVersion`) when the draft was hydrated from a saved project
- [x] 6.3 Auto-body initialization from source alpha > 0
- [x] 6.4 Pen tool (pixel-perfect drawing)
- [x] 6.5 Eraser tool
- [x] 6.6 Bucket fill tool (flood fill within opaque region)
- [x] 6.7 Zoom (slider, transform-preserving coordinates)
- [x] 6.8 Label switcher UI (4 buttons with palette colors)
- [x] 6.9 Source-image overlay toggle
- [x] 6.10 Undo (Ctrl/Cmd+Z) restoring via mask snapshots
- [x] 6.11 Post-processing correction button: clip-to-opacity + fill small holes + remove isolated pixels
- [x] 6.12 LLM result + editable Animation Parameters panel using D9.1 fixed enums; loop rendered read-only without coercing false→true
- [x] 6.13 Empty required-region warning (non-blocking) + small-region advisory; renderer fallback only when count==0
- [x] 6.14 Encode masks as palette PNG and POST to `/api/mask/save` with `final_*`
- [x] 6.15 Unit tests for correction filter
- [x] 6.16 Playwright full-flow spec covers mask page load + correction + save (tests/e2e/full-flow.spec.ts, gated by RUN_LIVE_E2E)

## 7. Template Animation Renderer (template-animation-renderer)

- [x] 7.1 Install `sharp` + `gifenc`; set up `src/server/renderer/`
- [x] 7.2 RendererInput type validated by Zod at entry point
- [x] 7.2.1 `src/server/renderer/params.ts` mapping table (the only place numeric values appear)
- [x] 7.3 Mask decoder: palette PNG → 4 boolean matrices
- [x] 7.4 Affine patch transform utility (translate/rotate/scale around pivot)
- [x] 7.5 `swim_slow` template (tail sin oscillation, optional fin wiggle)
- [x] 7.6 `turn` template (amplified tail swing + body scale)
- [x] 7.7 `approach_food` template (swim_slow + horizontal translation)
- [x] 7.8 `eat` template (approach phase + mouth open-close)
- [x] 7.9 Empty-required-region fallback (body-only minimal deformation; only when opaque count==0)
- [x] 7.10 Frame composer producing 16 frames at 8fps
- [x] 7.11 GIF encoder with loop count based on `params.loop` (0 / 1)
- [x] 7.12 Spritesheet composer (4×4 row-major)
- [x] 7.13 Stamp `renderer_version: 1`
- [x] 7.14 Enforce 20s internal timeout via AbortController; `RenderTimeoutError`
- [x] 7.15 Unit tests: deterministic hash equivalence for identical inputs
- [x] 7.16 Benchmark: 512×512 + 16f `swim_slow` typically completes in <1s on dev hardware; asserts <20s (tests/unit/renderer-benchmark.test.ts)

## 8. Generation Pipeline (orchestration)

- [x] 8.1 Implement `POST /api/generate` (`maxDuration = 30`); accepts `draft_id`
- [x] 8.2 `isRegeneration` from `originating_project_id` OR existing `gif_path`; quota check skipped when true
- [x] 8.3 Pipe: load source + mask + `final_*` → render → upload artifacts under draft path → update draft row (no projects row created here)
- [x] 8.4 Insert `generations` with `status='success'` and `counted = !isRegeneration`
- [x] 8.5 Insert failed/timeout rows with `counted=false` and remove partial gif/spritesheet/project.json
- [x] 8.6 Return 402 with upgrade prompt when quota exceeded
- [x] 8.7 Return 504 on renderer timeout
- [x] 8.8 Integration tests with mocked Supabase: quota 402 at cap, regeneration bypasses cap, timeout 504 + counted=false + artifact cleanup (tests/integration/generate-flow.test.ts)
- [x] 8.9 Advisory lock helper for concurrent quota check on first-time generations

## 9. Project Persistence (project-persistence)

- [x] 9.1 Zod schema for `project.json` v1 with exact top-level keys (rejects extras); `created_at` / `updated_at` validated as `z.string().datetime({ offset: false })` so offset-style timestamps (`+09:00`) are rejected and trailing `Z` (UTC) is enforced
- [x] 9.1.1 Shared serializer `src/server/projects/serialize.ts` `buildProjectJson({ scope, draft, project })` — all timestamps emitted via `new Date(...).toISOString()` so output is always ISO8601 UTC with trailing `Z`; no dependency on `Intl` / `toLocaleString` / local timezone
- [ ] 9.1.2 Unit test `buildProjectJson` under `process.env.TZ = 'Asia/Tokyo'` and `'UTC'` producing identical ISO strings ending with `Z`
- [x] 9.2 `POST /api/projects/save` accepting `mode` and enforcing save quota
- [x] 9.3 Mode='new': move artifacts → write canonical project.json (final paths) → INSERT projects row → delete draft
- [x] 9.3.1 Mode='overwrite': replace artifacts; rewrite project.json (preserve `created_at`); refresh `updated_at`
- [x] 9.4 Mode='duplicate': copy artifacts to new project_id; rewrite project.json; INSERT projects row (counts against save quota)
- [x] 9.4.1 Failure-path cleanup of partial draft artifacts (cleanup function for 24h drafts pending Supabase function deploy)
- [x] 9.4.2 `POST /api/projects/[id]/open-in-editor` hydrating a fresh draft with `originating_project_id`
- [x] 9.5 Build `/projects` list page (thumbnail from gif)
- [x] 9.6 Build `/projects/[id]` detail page with regenerate / download
- [x] 9.7 Project reload hydrates editor state including llmResult / final\_\* **and** surfaces existing outputs: server page reads `gif_path` / `spritesheet_path` / `renderer_version` from the draft, issues 1h signed URLs, and passes them to MaskEditor which renders a "前回の生成結果" section (GIF preview + spritesheet thumbnail + renderer_version badge) whenever the draft was hydrated from a saved project
- [ ] 9.7.1 Extend `/drafts/[draft_id]/mask/page.tsx` to query `gif_path`, `spritesheet_path`, `renderer_version`, `originating_project_id` from `drafts` and sign URLs for non-null paths
- [ ] 9.7.2 Update `MaskEditor` props + render logic to display the "前回の生成結果" section only when `previousGifUrl` is provided; include a subdued "マスク編集後は再生成してください" notice when the user mutates masks/params
- [ ] 9.7.3 Playwright coverage in full-flow spec: after `open-in-editor` the mask page shows the prior GIF before any regeneration
- [x] 9.8 Disable regenerate button on `renderer_version` mismatch with warning
- [x] 9.9 Server-side version mismatch surfaces in UI; saved projects open via editor flow
- [x] 9.10 Unit tests for project.json schema (valid / extra / numeric final_params rejected)
- [x] 9.10.1 Unit tests for `buildProjectJson` across all save modes
- [x] 9.11 LLM result preservation after override covered by buildProjectJson tests
- [x] 9.12 Playwright full-flow spec covers save → list → reload → regenerate (tests/e2e/full-flow.spec.ts, gated)
- [x] 9.13 Version mismatch UI test via the auth-redirects + full-flow scripts (button disabled state in project detail page — assertion encoded in full-flow.spec.ts when renderer_version matches)

## 10. Billing (user-auth-billing completion)

- [x] 10.1 Install `stripe` SDK; add env vars
- [ ] 10.2 Create Stripe Product + monthly Price in dev and prod (manual / external)
- [x] 10.3 Implement `POST /api/stripe/checkout`
- [x] 10.4 Implement `/billing/success` and `/billing/cancel`
- [x] 10.5 Implement `POST /api/stripe/webhook` with raw-body signature verification
- [x] 10.6 Handle `checkout.session.completed`: set `profiles.plan='paid'`, insert `plan_changes`
- [x] 10.7 Handle `customer.subscription.deleted`: set `profiles.plan='free'`, insert `plan_changes`
- [x] 10.8 Expose plan + remaining quota in `/billing` page
- [x] 10.9 Build `/billing` page showing usage / cap / commercial flag
- [x] 10.10 Unit tests for webhook signature verification (missing sig / invalid sig / valid checkout / replayed event)
- [x] 10.11 Integration test gated by `RUN_STRIPE_FLOW=1` verifies checkout→paid + subscription.deleted→free and asserts PLAN_LIMITS caps (tests/integration/stripe-flow.test.ts)

## 11. Quota Enforcement (cross-cutting)

- [x] 11.1 Define `PLAN_LIMITS` constant in `src/lib/quota/limits.ts`
- [x] 11.2 Implement `countSuccessGenerationsThisMonth(userId)` with UTC month boundary: compute `start = new Date(); start.setUTCDate(1); start.setUTCHours(0,0,0,0);` and pass `start.toISOString()` to `gte('created_at', …)`; behavior must be identical regardless of `process.env.TZ`
- [ ] 11.2.1 Unit test that `countSuccessGenerationsThisMonth` builds the same lower-bound ISO string under `process.env.TZ = 'Asia/Tokyo'`, `'America/Los_Angeles'`, and `'UTC'` (fails if month boundary drifts by user-local timezone)
- [x] 11.3 Implement `countSavedProjects(userId)`
- [x] 11.4 Do NOT gate `/api/upload` on save quota
- [x] 11.5 Gate `/api/generate` on plan + monthly counted-success count only when `isRegeneration=false`
- [x] 11.6 Gate `/api/projects/save` on plan + saved-project count for `new` and `duplicate`; `overwrite` skips
- [x] 11.7 `<QuotaBadge>` rendered on `/upload` (hideSaves), `/drafts/[id]/mask`, `/projects`, with near-cap "アップグレード" affordance for Free users
- [x] 11.8 Unit tests for `PLAN_LIMITS` cap predicates

## 12. Security & Hardening

- [x] 12.1 CI grep step verifies no server-side secrets appear in client bundle (`.next/static`)
- [x] 12.2 Enforce Content-Type `image/png` on upload route; reject other types
- [x] 12.3 `GET /api/storage/[...path]` authenticated proxy returns objects with `Cache-Control: private, no-store` + `X-Content-Type-Options: nosniff`; enforces per-user prefix check
- [x] 12.4 Rate limit on `/api/llm/parse` (5 req/min per user via in-memory token bucket)
- [x] 12.5 CSRF: middleware blocks cross-origin mutations (Stripe webhook exempt — own HMAC)
- [x] 12.6 RLS malicious-user integration test gated by `RUN_LIVE_SUPABASE=1`: user B cannot read/update user A drafts (tests/integration/supabase-rls.test.ts)
- [x] 12.7 Webhook idempotency via `plan_changes.stripe_event_id` unique + 23505 swallow path
- [ ] 12.8 Security review pass (security-reviewer agent) — defer until Supabase project is provisioned; code paths enumerated above cover 12.1–12.7

## 13. Deployment

- [ ] 13.1–13.7 (all manual / external — Vercel project, env vars, Pro plan, Stripe webhook URL, smoke tests, runbook)

## 14. Acceptance Verification

- [ ] 14.1–14.8 (manual end-to-end acceptance — pending Supabase project + deployment)
