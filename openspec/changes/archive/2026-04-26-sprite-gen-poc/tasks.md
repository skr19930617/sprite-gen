## 1. Bootstrap Local App Shell ✓

> Create the baseline FastAPI and React/Vite application shell, local-only dev wiring, and repo hygiene needed for all later work.

- [x] 1.1 Scaffold the FastAPI app with localhost binding, CORS policy, and placeholder route registration
- [x] 1.2 Scaffold the React + Vite TypeScript client entrypoint and shared API bootstrap
- [x] 1.3 Add local development startup wiring for server and client
- [x] 1.4 Ignore runtime project artifacts and other generated local state in git

## 2. Set Up Fixtures And Test Harness ✓

> Establish reusable fixtures and automated test harnesses for backend integration, renderer golden tests, and browser E2E flows.

> Depends on: repo-shell-bootstrap

- [x] 2.1 Create fixture source PNGs, mask samples, and output-setting samples for repeatable tests
- [x] 2.2 Create a mock Claude CLI script that can emit success and failure variants for both LLM stages
- [x] 2.3 Configure backend integration, renderer golden, and browser E2E test runners around the shared fixtures

## 3. Implement Project Store Core ✓

> Provide the filesystem-backed project layout, draft-slot helpers, mask presence utilities, and static asset serving contract.

> Depends on: repo-shell-bootstrap

- [x] 3.1 Implement project directory creation and v3 project.json read/write helpers
- [x] 3.2 Implement active-draft storage helpers, plan-token checks, and draft cleanup primitives
- [x] 3.3 Implement shared content-based mask presence utilities for missing-mask and labels-present checks
- [x] 3.4 Implement read-only static asset handlers and startup cleanup for stale staging and backup directories

## 4. Build Image Input Intake ✓

> Accept project creation uploads, validate output settings, convert supported PNG modes to RGBA, and persist the initial source plus body mask.

> Depends on: repo-shell-bootstrap, test-harness-and-fixtures, project-store-core

- [x] 4.1 Implement multipart POST /projects parsing and output-setting validation
- [x] 4.2 Implement PNG mode acceptance, RGBA conversion, and unsupported-mode rejection
- [x] 4.3 Persist source.png and auto-initialize body.png according to alpha and conversion rules
- [x] 4.4 Add integration coverage for valid uploads, invalid files, size limits, and range validation

## 5. Implement Mask Annotation Flow ✓

> Enable four-label mask editing with server-side cleanup filters, immediate persistence, and browser-based annotation UX.

> Depends on: repo-shell-bootstrap, test-harness-and-fixtures, project-store-core, image-input-intake

- [x] 5.1 Implement POST /projects/{id}/masks/{label} with mode and dimension validation plus per-label filter behavior
- [x] 5.2 Build the canvas editor with pen, eraser, bucket fill, zoom, undo, and label switching across body, tail, mouth, and fin
- [x] 5.3 Reload server-filtered masks into the canvas after debounced saves and expose derived-body and save-status feedback
- [x] 5.4 Add browser E2E coverage for four-label annotation and filter round-trips

## 6. Implement LLM Plan Draft Flow ✓

> Run the first LLM call, normalize and validate the plan, persist the active plan draft, and support params editing with stale-config invalidation.

> Depends on: repo-shell-bootstrap, test-harness-and-fixtures, project-store-core, image-input-intake

- [x] 6.1 Implement the Claude subprocess wrapper with JSON extraction, timeout handling, and auth or exit-code error mapping
- [x] 6.2 Validate and normalize llm-plan responses including single-animation enforcement, param defaults, and unsupported PoC type gating
- [x] 6.3 Persist the active plan draft, compute missing_masks from content-based mask checks, and support PATCH params updates with renderer-config invalidation
- [x] 6.4 Add integration tests for valid plans, invalid plans, missing masks, and draft persistence behavior

## 7. Build Renderer Core And Swim Template ✓

> Create the in-process renderer package, shared export pipeline, and deterministic swim_slow template implementation.

> Depends on: repo-shell-bootstrap, test-harness-and-fixtures

- [x] 7.1 Create the renderer core, template interface, and common GIF or spritesheet export helpers
- [x] 7.2 Implement fish_swim_slow_v1 with deterministic frame generation and args handling
- [x] 7.3 Add golden tests for swim_slow output stability and shared export behavior

## 8. Add Eat Template Support ✓

> Extend the renderer with the eat template so the PoC supports the second required animation type.

> Depends on: test-harness-and-fixtures, renderer-core-swim

- [x] 8.1 Implement fish_eat_v1 on the shared renderer core
- [x] 8.2 Register both supported templates and enforce deterministic template lookup
- [x] 8.3 Add golden coverage for eat output, mask interactions, and loop-sensitive export behavior

## 9. Implement Renderer Config Draft Flow ✓

> Run the second LLM call, validate template and args compatibility, persist renderer-config drafts, and expose args editing.

> Depends on: test-harness-and-fixtures, project-store-core, llm-plan-draft, renderer-core-swim, renderer-eat-template

- [x] 9.1 Implement POST /projects/{id}/renderer-config using the active plan draft and template compatibility checks
- [x] 9.2 Persist renderer_config.json with server-derived loop, plan_token, and created_at metadata
- [x] 9.3 Implement PATCH /projects/{id}/active-draft/renderer-config with args-only edit rules and forbidden-key rejection
- [x] 9.4 Add integration tests and UI support for valid configs, out-of-range args, and stale-draft rejection

## 10. Implement Animation Commit And Re-Render ✓

> Render from active drafts, atomically commit outputs and v3 animation entries, and support seed-from plus in-place re-render semantics.

> Depends on: test-harness-and-fixtures, project-store-core, llm-plan-draft, renderer-eat-template, llm-renderer-config-draft

- [x] 10.1 Implement POST /projects/{id}/animations with draft completeness checks, plan-token validation, and required-mask revalidation
- [x] 10.2 Stage renderer outputs under animations/.tmp and atomically commit animation directories plus project.json updates
- [x] 10.3 Implement seed-from and POST /projects/{id}/animations/{animation_id}/re-render with backup-and-replace rollback
- [x] 10.4 Return hydrated v3 animation responses and clear active drafts only after successful commit

## 11. Build Project Library Management ✓

> Support listing, reopening, duplicating, deleting, and hydrating persisted projects and animations from the filesystem store.

> Depends on: test-harness-and-fixtures, project-store-core, animation-commit-and-rerender

- [x] 11.1 Implement GET /projects and GET /projects/{id} with thumbnail summaries, inline renderer_config hydration, and static URLs
- [x] 11.2 Implement duplicate and delete endpoints with empty-animation duplicate semantics and project cleanup
- [x] 11.3 Build the project library UI for reopen, duplicate, and delete actions
- [x] 11.4 Add persistence coverage for reload after restart and duplicate-save constraints

## 12. Wire Input To Annotation Screens ✓

> Connect the input, params, and annotation screens to the backend contracts through the first half of the generation lifecycle.

> Depends on: test-harness-and-fixtures, image-input-intake, mask-annotation-flow, llm-plan-draft

- [x] 12.1 Connect the Input screen to project creation and output-setting validation responses
- [x] 12.2 Connect the Params screen to llm-plan responses, params PATCH updates, and draft resume behavior
- [x] 12.3 Connect the Annotation screen to required and optional regions, skip-friendly mask flow, and renderer-config handoff
- [x] 12.4 Add E2E coverage for the upload-to-annotation path including missing-mask prompts

## 13. Wire Result Flow And Regeneration ✓

> Connect the result screen and animation history UX to renderer-config drafts, rendering, re-rendering, add-another-animation, and reopen flows.

> Depends on: test-harness-and-fixtures, llm-renderer-config-draft, animation-commit-and-rerender, project-library-management, input-to-annotation-ui

- [x] 13.1 Build the Result screen around renderer-config drafts, args editing, and render submission
- [x] 13.2 Implement Add another animation and seed-from-based Re-generate transitions
- [x] 13.3 Hydrate reopened projects into result or draft states using library data and active_draft metadata
- [x] 13.4 Add end-to-end coverage for two animations, in-place re-render, and project reopen

## 14. Implement Failure Recovery And UX Polish ✓

> Make LLM and render failures recoverable without corrupting project state while polishing save, resume, and retry behavior.

> Depends on: test-harness-and-fixtures, llm-plan-draft, llm-renderer-config-draft, animation-commit-and-rerender, project-library-management, input-to-annotation-ui, result-flow-and-regeneration-ui

- [x] 14.1 Surface retriable versus non-retriable LLM and renderer errors while preserving prompt and output inputs for retry
- [x] 14.2 Implement explicit Save feedback, draft resume on reload, and abandon-draft clearing behavior
- [x] 14.3 Verify that all mapped failure modes leave project files, drafts, and committed animations uncorrupted
- [x] 14.4 Add integration and E2E regression coverage for failure scenarios and recovery after server restart
