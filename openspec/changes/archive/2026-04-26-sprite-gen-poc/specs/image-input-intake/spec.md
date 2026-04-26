## ADDED Requirements

### Requirement: PNG upload validation

The system SHALL validate uploaded source images and reject inputs that violate PoC constraints with a user-visible error before any persistence.

The accepted constraints are:

- file format: PNG only
- color mode: RGBA. RGB and grayscale inputs SHALL be auto-converted to RGBA on the server (alpha=255 for opaque pixels).
- max dimensions: 2048×2048 px (inclusive).
- max file size: 10 MB.

#### Scenario: Accept a valid transparent PNG

- **WHEN** the user uploads a 512×512 RGBA PNG of 1.2 MB
- **THEN** the server SHALL accept it, store it as `projects/<project_id>/source.png`, and return the assigned `project_id` and image dimensions to the UI.

#### Scenario: Reject oversized image dimensions

- **WHEN** the user uploads a 4096×4096 PNG
- **THEN** the server SHALL reject the upload with HTTP 400 and a message `"image dimensions exceed 2048x2048"`, and SHALL NOT create or update any project directory.

#### Scenario: Reject non-PNG input

- **WHEN** the user uploads a JPEG file
- **THEN** the server SHALL reject the upload with HTTP 400 and a message `"only PNG is supported"`.

#### Scenario: Auto-convert RGB to RGBA

- **WHEN** the user uploads an RGB-mode PNG within size limits
- **THEN** the server SHALL convert it to RGBA with all alpha values set to 255 before persistence, and downstream `body` initialization SHALL treat the entire image as opaque.

### Requirement: Output condition input

The system SHALL collect output conditions from the UI and validate them server-side before any rendering. The accepted shape is:

- `output_width`: integer, 64–512 inclusive
- `output_height`: integer, 64–512 inclusive
- `fps`: integer, 1–30 inclusive
- `frame_count`: integer, 2–32 inclusive
- `export_format`: enum `gif` | `spritesheet` | `both`

The displayed `duration_sec` SHALL be derived from `frame_count / fps` and SHALL NOT be a separate input.

#### Scenario: Accept valid output conditions

- **WHEN** the UI submits `output_width=128, output_height=128, fps=12, frame_count=8, export_format=both`
- **THEN** the server SHALL accept the values, persist them on the project, and the UI SHALL display `duration_sec = 0.667` (= 8 / 12, rounded for display).

#### Scenario: Reject fps outside allowed range

- **WHEN** the UI submits `fps=0` or `fps=60`
- **THEN** the server SHALL reject the request with HTTP 400 and a message `"fps must be between 1 and 30"`.

#### Scenario: Reject frame_count below minimum

- **WHEN** the UI submits `frame_count=1`
- **THEN** the server SHALL reject the request with HTTP 400 and a message `"frame_count must be between 2 and 32"`.
