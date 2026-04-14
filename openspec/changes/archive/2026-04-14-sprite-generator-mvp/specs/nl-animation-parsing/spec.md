## ADDED Requirements

### Requirement: LLM fixed-structure output

The system SHALL convert a natural-language prompt into a fixed-structure JSON result using Anthropic Claude API (`claude-haiku-4-5` default). The LLM MUST return exactly the following keys: `entity_type`, `animation_type`, `required_regions`, `optional_regions`, `params`. Free-form rendering instructions MUST NOT be accepted.

#### Scenario: Successful parse returns valid structure

- **WHEN** the system sends prompt "餌に近づいて口をぱくっと開ける" to the LLM
- **THEN** the LLM returns a JSON object where `entity_type` = "fish", `animation_type` ∈ {`swim_slow`, `turn`, `approach_food`, `eat`}, `required_regions` ⊆ {`body`, `tail`, `mouth`, `fin`}, `optional_regions` ⊆ {`body`, `tail`, `mouth`, `fin`}, and `params` contains exactly `speed` / `amplitude` / `emphasis` / `loop`

#### Scenario: Invalid LLM output rejected

- **WHEN** the LLM returns a response that violates the schema (missing keys, unknown animation_type, extra fields)
- **THEN** the system rejects the response and displays an error; no project data is created

### Requirement: Structured output enforcement via tool_use

The system SHALL enforce the output schema using Claude's `tool_use` mechanism with an explicit JSON schema definition. The system MUST NOT rely on free-form text parsing.

#### Scenario: LLM call uses tool_use

- **WHEN** the system invokes the LLM
- **THEN** the request includes a `tools` parameter defining the expected schema and `tool_choice` forcing that tool

### Requirement: Fixed vocabulary for animation_type

The system SHALL restrict `animation_type` to exactly four values: `swim_slow`, `turn`, `approach_food`, `eat`. Any other value MUST be rejected.

#### Scenario: Unknown animation_type rejected

- **WHEN** the LLM returns `animation_type` = "dance"
- **THEN** the system rejects the response as invalid

### Requirement: Fixed vocabulary for regions

The system SHALL restrict `required_regions` and `optional_regions` entries to exactly four values: `body`, `tail`, `mouth`, `fin`. `entity_type` MUST always be `fish` in MVP.

#### Scenario: Unknown region rejected

- **WHEN** the LLM returns `required_regions` containing "eye"
- **THEN** the system rejects the response as invalid

### Requirement: Fixed parameter keys

The system SHALL restrict `params` to exactly four keys: `speed` (`slow` | `medium`), `amplitude` (`small` | `medium`), `emphasis` (`none` | `tail` | `mouth` | `fin`), `loop` (boolean). Missing or extra keys MUST cause rejection.

#### Scenario: Valid params accepted

- **WHEN** the LLM returns `params` = `{"speed": "slow", "amplitude": "small", "emphasis": "mouth", "loop": true}`
- **THEN** the system accepts the params

#### Scenario: Extra key rejected

- **WHEN** the LLM returns `params` containing a fifth key `acceleration`
- **THEN** the system rejects the response as invalid

### Requirement: User override of LLM result

The system SHALL allow users to override the LLM-chosen `animation_type` via a dropdown on the region-masking screen. The final value stored as `final_animation_type` MAY differ from the LLM's initial `animation_type`.

#### Scenario: User changes animation_type

- **WHEN** the LLM returns `animation_type` = "eat" and the user selects `swim_slow` from the dropdown
- **THEN** the system uses `swim_slow` for rendering and stores `final_animation_type` = "swim_slow" while preserving the original LLM result

### Requirement: Secret isolation

The system SHALL keep the Anthropic API key on the server side only. The key MUST NOT be included in any client-side bundle or exposed via any public endpoint.

#### Scenario: Client bundle contains no API key

- **WHEN** the production client bundle is inspected
- **THEN** it contains no reference to the Anthropic API key
