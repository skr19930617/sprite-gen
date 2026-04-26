## ADDED Requirements

### Requirement: Required animation templates

The renderer SHALL implement at minimum the `fish_swim_slow_v1` and `fish_eat_v1` templates. These templates correspond to `animation_type=swim_slow` and `animation_type=eat` respectively. Other animation_type templates (`turn`, `approach_food`) MAY be added but are NOT required for PoC acceptance.

#### Scenario: swim_slow template renders an animated tail

- **WHEN** the renderer is invoked with `renderer_template="fish_swim_slow_v1"`, a tail mask, and `args={tail_amplitude:0.2, frames:8, fps:12, ...}`
- **THEN** the renderer SHALL produce 8 frames in which the tail-masked region oscillates left-right with a peak displacement matching the tail_amplitude scaling, and SHALL emit a GIF and/or spritesheet according to the project's `export_format`.

#### Scenario: eat template animates mouth opening and tail micro-motion

- **WHEN** the renderer is invoked with `renderer_template="fish_eat_v1"`, masks for tail and mouth, and `args={mouth_open_ratio:0.35, tail_amplitude:0.1, frames:8, fps:12, ...}`
- **THEN** the renderer SHALL produce 8 frames in which the mouth-masked region opens and closes (peak open at the midpoint of the loop) and the tail oscillates with low amplitude.

### Requirement: Mask label identification priority

The renderer SHALL classify each pixel into a single label using the priority order `tail > mouth > fin > body`. A pixel that is set in multiple masks SHALL be classified as the highest-priority label among those it belongs to.

`body` SHALL be treated as the residual region (`body \ tail \ mouth \ fin`) for the purpose of warp/bend transforms, even when the source `body.png` overlaps the other labels.

#### Scenario: Tail wins over body when overlapping

- **WHEN** a pixel is set in both `body.png` and `tail.png`
- **THEN** the renderer SHALL treat that pixel as `tail`-only when applying transforms.

#### Scenario: Mouth wins over body but loses to tail

- **WHEN** a pixel is set in `body.png`, `mouth.png`, and `tail.png`
- **THEN** the renderer SHALL classify it as `tail`.

### Requirement: GIF and spritesheet output

The renderer SHALL produce outputs based on the project's `export_format`:

- `gif`: a GIF file with `fps` frames per second and `frames` frames per loop, looping if `params.loop=true`.
- `spritesheet`: a single PNG containing all frames laid out horizontally in one row, each cell sized `output_width × output_height`. The total spritesheet width SHALL be `frames * output_width`.
- `both`: emit both a GIF and a spritesheet PNG.

The output filenames SHALL be `result.gif` and `spritesheet.png` inside the active animation's directory.

#### Scenario: Both formats emitted for export_format=both

- **WHEN** the project's `export_format=both` and `frames=8, fps=12, output_width=128, output_height=128`
- **THEN** the renderer SHALL write `result.gif` (animated, 8 frames, 12 fps) and `spritesheet.png` (1024×128 px, 8 cells of 128×128) inside `animations/<animation_id>/`.

#### Scenario: Spritesheet not emitted for export_format=gif

- **WHEN** the project's `export_format=gif`
- **THEN** the renderer SHALL write `result.gif` only and SHALL NOT write `spritesheet.png`.

### Requirement: Renderer is not LLM-generated code

The renderer SHALL be implemented as fixed Python code in the repository. The LLM SHALL NOT supply renderer logic; it only chooses the template id and the numeric args. Any attempt to inject method B (LLM-emitted code) SHALL be ignored at this layer.

#### Scenario: Unknown template id is rejected

- **WHEN** `renderer_template="fish_jump_v1"` is requested but no such template exists
- **THEN** the renderer SHALL raise an error and the server SHALL surface `"unknown renderer_template: fish_jump_v1"` to the UI without writing any output files.
