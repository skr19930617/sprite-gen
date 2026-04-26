# local-app-shell Specification

## Purpose
TBD - created by archiving change sprite-gen-poc. Update Purpose after archive.
## Requirements
### Requirement: Local-only deployment posture

The application SHALL be a local-first PoC. The HTTP server SHALL bind to `127.0.0.1` only by default and SHALL NOT expose any externally-reachable interface. There SHALL be no authentication, no multi-user separation, and no remote storage. SaaS, payments, async job queues, and cloud persistence are explicitly out of scope.

#### Scenario: Default bind is loopback

- **WHEN** the server is started with default configuration
- **THEN** it SHALL listen on `127.0.0.1:<port>` only and SHALL NOT bind to `0.0.0.0`.

### Requirement: UI screens

The UI SHALL provide four primary screens, navigable per a single project session:

1. **Input screen**: PNG upload, prompt textbox, output condition form (`output_width`, `output_height`, `fps`, `frame_count`, `export_format`), and a "Start" action.
2. **Annotation screen**: shows the LLM's required/optional regions, the source image, mask editing tools per label (per `mask-annotation-ui`), and a "Generate" action.
3. **Result screen**: displays the latest GIF preview, spritesheet preview (if produced), the resolved `params` and `args`, the resolved `renderer_template`, and actions to "Save", "Re-generate" (re-run renderer with current args), and "Add another animation" (return to a fresh prompt within the same project).
4. **Project library screen**: lists saved projects with thumbnails and animation summaries, supporting "Open", "Duplicate save", and "Delete" (Delete removes the entire `projects/<project_id>/` directory).

#### Scenario: Add another animation returns to the prompt step

- **WHEN** the user is on the Result screen and clicks "Add another animation"
- **THEN** the UI SHALL navigate to a prompt input that reuses the current source and masks, and the next successful LLM-renderer-config call SHALL append a new entry to `project.json.animations`.

#### Scenario: Project library opens existing project

- **WHEN** the user picks an existing project from the library and clicks "Open"
- **THEN** the UI SHALL load source, masks, and animation history into the Result screen, allowing further "Add another animation" operations.

### Requirement: Layered responsibilities

The system SHALL be organized into four layers with the following responsibilities:

- **UI** (React + Vite): presentation, mask drawing, form editing, navigation, file download.
- **Local server** (FastAPI + uvicorn): HTTP API, validation, project lifecycle, LLM subprocess orchestration, renderer invocation.
- **LLM client**: subprocess invocation of the Claude Code CLI per `llm-plan-analysis` and `llm-renderer-config` requirements.
- **Renderer**: fixed Python templates per `template-renderer` requirements.

The UI SHALL NOT call the LLM CLI directly; all LLM invocations SHALL go through the server. The renderer SHALL run in-process inside the server (no separate worker).

#### Scenario: UI requests animation generation through the server

- **WHEN** the user clicks "Generate" on the Annotation screen
- **THEN** the UI SHALL POST the project state to the server's `/animations` (or equivalent) endpoint, and the server SHALL coordinate the second LLM call and the renderer call before responding with the new animation entry.

### Requirement: Synchronous request handling

Server endpoints that trigger an LLM call and/or rendering SHALL handle the request synchronously within the HTTP request/response cycle. There SHALL be no background job queue, no worker process, and no polling endpoint. The server MAY hold the request open for the duration of the LLM call (up to the 60-second timeout) and the rendering pass.

#### Scenario: Generation endpoint blocks until done

- **WHEN** the UI calls the generate endpoint
- **THEN** the server SHALL block the request until either (a) the animation is appended successfully and a 200 response with the new entry is returned, or (b) an error per the `llm-renderer-config` failure modes is returned.

