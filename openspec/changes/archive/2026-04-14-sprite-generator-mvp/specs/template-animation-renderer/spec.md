## ADDED Requirements

### Requirement: Four fixed animation templates

The system SHALL support exactly four animation templates: `swim_slow`, `turn`, `approach_food`, `eat`. Each template MUST be implemented as a deterministic function of (source image, mask, params) so that identical inputs produce identical outputs.

#### Scenario: swim_slow renders tail oscillation loop

- **WHEN** the renderer is called with `animation_type` = "swim_slow" and a non-empty tail mask
- **THEN** it produces frames where the tail region oscillates periodically left-right, and optionally the fin region animates when fin mask is present

#### Scenario: turn renders amplified tail swing

- **WHEN** the renderer is called with `animation_type` = "turn"
- **THEN** it produces frames with temporarily amplified tail swing and a tempo change indicating direction change

#### Scenario: approach_food renders directional motion

- **WHEN** the renderer is called with `animation_type` = "approach_food"
- **THEN** it produces frames showing more active tail propulsion than swim_slow with a short translation motion

#### Scenario: eat renders mouth open-close

- **WHEN** the renderer is called with `animation_type` = "eat" and non-empty tail and mouth masks
- **THEN** it produces frames combining a short approach phase and a mouth open-close cycle; the emphasis param MAY amplify mouth deformation

### Requirement: Output frame and rate limits

The system SHALL render exactly **16 frames at 8fps** per animation. Input images exceeding **512x512px** MUST be rejected at upload time. Rendering MUST complete synchronously within **30 seconds**; exceeding this MUST raise a timeout error.

#### Scenario: Generates 16-frame 2-second animation

- **WHEN** the renderer is called with valid inputs
- **THEN** it produces exactly 16 frames representing 2 seconds of animation at 8fps

#### Scenario: Renderer timeout raises error

- **WHEN** rendering exceeds 30 seconds
- **THEN** the renderer aborts, surfaces a timeout error to the UI, and the generation is not counted toward the user's free-tier quota

### Requirement: GIF output

The system SHALL produce an animated GIF of the rendered frames. The GIF MUST loop when `params.loop` is true, and play once when false.

#### Scenario: Loop true produces looping GIF

- **WHEN** rendering with `params.loop` = true
- **THEN** the output GIF has loop count = 0 (infinite)

#### Scenario: Loop false produces single-play GIF

- **WHEN** rendering with `params.loop` = false
- **THEN** the output GIF has loop count = 1

### Requirement: Spritesheet output

The system SHALL produce a spritesheet PNG containing all 16 frames arranged in a deterministic grid (e.g., 4x4). The frame order MUST match the GIF frame order.

#### Scenario: Spritesheet layout

- **WHEN** rendering completes
- **THEN** the spritesheet PNG contains 16 frames in row-major order matching the GIF sequence

### Requirement: Renderer version tag

The system SHALL stamp every rendered output with `renderer_version = 1` in the associated `project.json`. Future incompatible rendering changes MUST increment this version.

#### Scenario: Render stamps version

- **WHEN** the renderer finishes
- **THEN** the updated `project.json` contains `renderer_version: 1`

### Requirement: Empty required-region fallback

The system SHALL produce a valid animation even when a required region mask is empty, using a minimal body-only deformation. This MUST be a documented degraded mode, not a silent skip.

#### Scenario: Empty tail mask triggers fallback

- **WHEN** `animation_type` = "swim_slow" is rendered with an empty tail mask but non-empty body mask
- **THEN** the renderer produces frames with small periodic body deformation only, completing successfully
