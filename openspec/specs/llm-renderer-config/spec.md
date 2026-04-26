# llm-renderer-config Specification

## Purpose
TBD - created by archiving change sprite-gen-poc. Update Purpose after archive.
## Requirements
### Requirement: Renderer config output schema

After annotation, the server SHALL invoke the LLM a second time with `{source_image_path, mask_dir, output_size, fps, frame_count, prompt, llm_plan, mask_labels_present}` as input, and SHALL accept only LLM responses that match this schema:

```
{
  "renderer_template": "<template id, e.g. fish_swim_slow_v1, fish_eat_v1>",
  "args": {
    "tail_amplitude": <float in [0.0, 1.0]>,
    "mouth_open_ratio": <float in [0.0, 1.0]>,
    "body_follow": <float in [0.0, 0.5]>,
    "fps": <int copied from input>,
    "frames": <int copied from input frame_count>,
    "output_width": <int copied from input>,
    "output_height": <int copied from input>
  }
}
```

Constraints:

- `renderer_template` MUST identify a known fixed template that exists in `template-renderer`.
- All `args` numeric values MUST fall within the declared ranges; out-of-range values SHALL be rejected with a user-visible error.
- The `fps` / `frames` / `output_width` / `output_height` returned by the LLM MUST equal the values in the input; the server SHALL overwrite any divergence with the user's input values to enforce the contract.
- Method B (LLM-emitted code) is NOT in scope for this PoC.

#### Scenario: Valid renderer config accepted

- **WHEN** the LLM returns `{renderer_template:"fish_eat_v1", args:{tail_amplitude:0.2, mouth_open_ratio:0.35, body_follow:0.1, fps:12, frames:8, output_width:128, output_height:128}}` and the user-supplied output conditions match
- **THEN** the server SHALL accept the config, persist it as `animations/<animation_id>/renderer_config.json`, and pass it to the renderer.

#### Scenario: Reject out-of-range numeric arg

- **WHEN** the LLM returns `tail_amplitude=1.5`
- **THEN** the server SHALL reject the config with `"args.tail_amplitude must be in [0.0, 1.0]"` and SHALL NOT call the renderer.

#### Scenario: Server overwrites mismatched fps

- **WHEN** the user submits `fps=12` but the LLM returns `fps=24` in `args`
- **THEN** the server SHALL overwrite `args.fps` to 12 before persisting and rendering, and SHALL log a warning containing both values.

### Requirement: User can re-edit args before render

The UI SHALL render the resolved `args` as a numeric form (with the declared ranges as bounds). User edits SHALL replace the LLM-provided values before the renderer is invoked.

#### Scenario: User adjusts tail_amplitude before render

- **WHEN** the LLM returned `tail_amplitude=0.2` and the user changes it to `0.4` in the UI
- **THEN** the renderer SHALL be invoked with `tail_amplitude=0.4`, and the persisted `renderer_config.json` SHALL reflect 0.4.

### Requirement: LLM CLI failure handling

If the Claude Code CLI invocation fails for any of the following reasons, the server SHALL surface a user-visible error to the UI and SHALL NOT auto-retry:

- non-zero exit
- empty stdout
- stdout is not valid JSON
- response does not match the schema
- timeout exceeding 60 seconds
- authentication not completed (CLI prompts that the server cannot answer)

In all of these cases, the server SHALL preserve the project state (source, masks, output conditions, prompt) so the user can press a "Retry" button to re-issue the same input. A new `animations/<animation_id>/` entry SHALL only be created when the LLM produces a valid config that passes schema validation.

#### Scenario: Timeout produces user-visible error and no animation entry

- **WHEN** the CLI does not respond within 60 seconds
- **THEN** the server SHALL kill the subprocess, return HTTP 504 with `{error_kind:"llm_timeout", retriable:true}`, and the project directory SHALL remain unchanged (no new `animations/<animation_id>/`).

#### Scenario: Invalid JSON produces user-visible error and no animation entry

- **WHEN** the CLI exits 0 but stdout cannot be parsed as JSON
- **THEN** the server SHALL return `{error_kind:"llm_invalid_json", retriable:true}` and SHALL NOT persist any animation entry.

#### Scenario: Missing claude binary halts the request

- **WHEN** the `claude` binary is not found on PATH
- **THEN** the server SHALL return `{error_kind:"llm_cli_not_found", retriable:false}` with a hint to install Claude Code CLI.

