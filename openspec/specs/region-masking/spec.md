# region-masking Specification

## Purpose
TBD - created by archiving change sprite-generator-mvp. Update Purpose after archive.
## Requirements
### Requirement: Fixed region vocabulary

The system SHALL use exactly four region labels: `body`, `tail`, `mouth`, `fin`. Each label MUST have a distinct color in the mask palette (default: `body=#FFFFFF`, `tail=#0000FF`, `mouth=#FF0000`, `fin=#00FF00`).

#### Scenario: User switches between four labels

- **WHEN** a user opens the mask editor
- **THEN** the UI presents exactly four label buttons: body, tail, mouth, fin — no others

### Requirement: Automatic body initialization

The system SHALL automatically initialize the `body` region by selecting all opaque pixels (alpha > 0) of the uploaded source image. Users MAY subsequently modify this initial `body` mask.

#### Scenario: Auto-init on first open

- **WHEN** a user enters the mask editor for the first time after upload
- **THEN** the `body` mask is populated with every pixel where the source alpha > 0

#### Scenario: User overrides body mask

- **WHEN** a user paints or erases on the `body` layer after auto-init
- **THEN** the modified mask replaces the auto-initialized one

### Requirement: Mask editor essential tools

The system SHALL provide pen, eraser, bucket fill, zoom, label-switching, source-image overlay toggle, and undo for mask editing. The editor MUST NOT include advanced paint features (layers, blending modes, filters, smart selection).

#### Scenario: Pen draws on active label

- **WHEN** a user selects the `tail` label and drags the pen over the canvas
- **THEN** the dragged pixels are added to the tail mask using the tail palette color

#### Scenario: Undo reverts last stroke

- **WHEN** a user draws a stroke then triggers undo (Ctrl/Cmd+Z or button)
- **THEN** the most recent stroke is removed from the mask

### Requirement: Mask post-processing correction filter

Upon user request (via a "補正" button), the system SHALL apply a post-processing filter to the current mask: (1) clip any painted pixels outside the source image's opaque region, (2) fill small unfilled holes within a region, (3) remove isolated single pixels. This MUST be applied as a post-processing operation, not during drawing.

#### Scenario: Correction clips outside opacity

- **WHEN** a user has painted tail pixels onto fully transparent source areas and triggers correction
- **THEN** those out-of-bounds pixels are removed from the tail mask

#### Scenario: Correction fills small holes

- **WHEN** a user has a tail mask with a 2x2 unfilled hole surrounded by tail pixels and triggers correction
- **THEN** the hole is filled with tail label

#### Scenario: Correction removes isolated pixels

- **WHEN** a user has a single isolated tail pixel with no neighbors and triggers correction
- **THEN** the isolated pixel is removed

### Requirement: Empty required-region fallback

The system SHALL allow generation to proceed even when a `required_region` mask is empty (unlabeled). In that case the renderer MUST fall back to a minimal body-only deformation and the UI MUST display a warning "{region} が指定されていません — 簡略生成になります" before submission.

#### Scenario: Empty tail mask warns but proceeds

- **WHEN** a user submits generation with `animation_type` = "swim_slow" (requires tail) but tail mask is empty
- **THEN** the UI displays a warning and the renderer uses a fallback body-only minimal deformation

### Requirement: Source image overlay

The system SHALL allow users to toggle an overlay of the source image beneath the mask layers for visual reference. Overlay MUST be display-only and MUST NOT modify the mask.

#### Scenario: Overlay toggle

- **WHEN** a user toggles the source overlay on
- **THEN** the source image is rendered semi-transparently below the mask layers

