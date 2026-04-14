# image-upload Specification

## Purpose
TBD - created by archiving change sprite-generator-mvp. Update Purpose after archive.
## Requirements
### Requirement: Transparent PNG image upload

The system SHALL accept a single transparent PNG image file as the source input for sprite generation. Non-transparent PNG (no alpha channel or fully opaque alpha), JPEG, and other formats MUST be rejected with a clear error message before any processing.

#### Scenario: Valid transparent PNG upload

- **WHEN** a user selects a PNG file whose alpha channel contains at least one transparent pixel
- **THEN** the system accepts the upload, displays a preview, and enables the prompt input

#### Scenario: Rejected non-transparent PNG

- **WHEN** a user uploads a PNG file whose alpha channel is fully opaque (no transparent pixels)
- **THEN** the system rejects the upload with an error message stating "透過 PNG が必要です"

#### Scenario: Rejected JPEG or other format

- **WHEN** a user uploads a file that is not a PNG (JPEG, GIF, WebP, etc.)
- **THEN** the system rejects the upload with an error message stating the accepted format is transparent PNG only

### Requirement: Input size constraint

The system SHALL enforce a maximum input image size of 512x512 pixels. Images exceeding this size in either dimension MUST be rejected before processing.

#### Scenario: Image within size limit

- **WHEN** a user uploads a PNG with dimensions ≤ 512x512
- **THEN** the system accepts the upload

#### Scenario: Image exceeds size limit

- **WHEN** a user uploads a PNG wider than 512 pixels or taller than 512 pixels
- **THEN** the system rejects the upload with an error message stating the 512x512 limit

### Requirement: Natural language prompt input

The system SHALL provide a text input field for users to describe the desired animation in natural language (Japanese or English). The prompt MUST be non-empty to proceed to LLM analysis.

#### Scenario: Prompt entry and submit

- **WHEN** a user enters a non-empty prompt such as "ゆっくり泳がせたい" and submits the upload form
- **THEN** the system advances to the LLM analysis step with the image and prompt attached

#### Scenario: Empty prompt blocks submission

- **WHEN** a user submits the form with an empty prompt
- **THEN** the system displays a validation error and does not advance

### Requirement: Image preview

The system SHALL display a preview of the uploaded image on a checker-pattern background so users can visually verify the transparency and content before submitting.

#### Scenario: Preview renders after upload

- **WHEN** a user uploads a valid transparent PNG
- **THEN** the preview area displays the image on a checker-pattern background

