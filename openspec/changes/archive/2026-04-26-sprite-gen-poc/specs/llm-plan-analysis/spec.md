## ADDED Requirements

### Requirement: Initial LLM plan output schema

When the user submits a prompt with output conditions, the server SHALL invoke the LLM with a structured prompt and SHALL accept only responses that match this fixed schema (single animation per call):

```
{
  "entity_type": "fish",
  "animation_type": "<one of: swim_slow|turn|approach_food|eat>",
  "required_regions": ["<from: body|tail|mouth|fin>", ...],
  "optional_regions": ["<from: body|tail|mouth|fin>", ...],
  "params": {
    "speed": "slow" | "medium",
    "amplitude": "small" | "medium",
    "emphasis": "none" | "tail" | "mouth" | "fin",
    "loop": true | false
  },
  "annotation_schema": [
    { "label": "<part vocab>", "required": <bool> }
  ]
}
```

Constraints:

- `entity_type` MUST be the literal string `"fish"`.
- `animation_type` MUST be one of the four enum values; any other value SHALL be rejected as an invalid plan.
- `required_regions` and `optional_regions` MUST be drawn from the fixed part vocabulary `body|tail|mouth|fin` only.
- `params` MUST contain exactly the four keys with values from the listed enums or boolean.
- `annotation_schema` entries MUST use part vocabulary labels.

#### Scenario: Valid plan accepted

- **WHEN** the LLM returns a plan with `animation_type=eat, required_regions=["tail","mouth"], optional_regions=["fin"], params={speed:"slow", amplitude:"small", emphasis:"mouth", loop:true}`
- **THEN** the server SHALL accept the plan, persist it as the active animation's `llm_plan`, and forward it to the UI for the annotation step.

#### Scenario: Reject unknown animation_type

- **WHEN** the LLM returns `animation_type=jump`
- **THEN** the server SHALL reject the plan, MUST NOT persist it, and SHALL surface a user-visible error `"LLM returned invalid animation_type: jump"`.

#### Scenario: Reject unknown region label

- **WHEN** the LLM returns `required_regions=["wing"]`
- **THEN** the server SHALL reject the plan with `"LLM returned invalid region: wing"`.

### Requirement: Default param values per animation_type

When the LLM omits a `params` value (e.g., null or missing key), the server SHALL fill in defaults consistent with the animation_type before sending the plan to the UI:

- `speed` default: `slow`
- `amplitude` default: `small`
- `emphasis` default: depends on `animation_type` — `swim_slow` → `tail`; `eat` → `mouth`; `turn` → `tail`; `approach_food` → `tail`.
- `loop` default: `true`

#### Scenario: Fill missing emphasis from animation_type

- **WHEN** the LLM returns a plan with `animation_type=eat` and `params.emphasis` missing
- **THEN** the server SHALL substitute `emphasis="mouth"` and persist the resolved plan.

### Requirement: One animation per LLM invocation

The first-pass LLM analysis SHALL plan exactly one `animation_type` per invocation. Multiple animations within a single project are produced by repeating the prompt → annotate → render workflow, NOT by returning a list of animations from a single LLM call.

#### Scenario: LLM returns single animation_type

- **WHEN** the user submits one prompt
- **THEN** the server SHALL receive and accept exactly one `animation_type` and SHALL reject any LLM output containing an `animations[]` array of plans.

### Requirement: User can re-edit params before annotation

The UI SHALL render the resolved `params` as a form whose enum fields are editable by the user. Edits SHALL be persisted as the active plan before the user proceeds to annotation. The `animation_type` itself SHALL NOT be editable in the form (re-prompting is required to change it).

#### Scenario: User edits speed before annotation

- **WHEN** the LLM returned `params.speed="slow"` and the user changes it to `medium` in the UI
- **THEN** the persisted plan and the data forwarded to the next phase SHALL reflect `params.speed="medium"`.
