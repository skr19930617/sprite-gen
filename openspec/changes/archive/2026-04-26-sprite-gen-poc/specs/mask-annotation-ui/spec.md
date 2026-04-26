## ADDED Requirements

### Requirement: Body auto-initialization

When a project is created from an uploaded source image, the system SHALL initialize `body.png` as a binary mask matching the source's `alpha >= 128` region (1=opaque, 0=otherwise). The image dimensions of `body.png` SHALL match the source image dimensions.

#### Scenario: Body initialized from RGBA source

- **WHEN** a 512×512 RGBA source is uploaded with a centered fish silhouette where alpha is 0 in the background and 255 in the silhouette
- **THEN** the server SHALL persist `mask/body.png` as a 512×512 grayscale PNG with white pixels exactly where alpha >= 128 in the source.

#### Scenario: Body for fully opaque source

- **WHEN** the source PNG has alpha=255 across the entire image (e.g., RGB-converted to RGBA)
- **THEN** `body.png` SHALL be entirely white, and the user SHALL be free to refine it manually in the UI.

### Requirement: Mask editing tools

The annotation UI SHALL provide the following editing tools for each label among `body`, `tail`, `mouth`, `fin`:

- pen: paint mask pixels for the active label
- eraser: clear mask pixels for the active label
- bucket fill: fill a contiguous region for the active label
- zoom: zoom in/out for fine-grained editing
- undo: revert the most recent action
- label switch: change the active label among the four part labels

The UI SHALL display the source image as a translucent backdrop and overlay the active label's mask in a distinct color.

#### Scenario: Pen tool paints active label

- **WHEN** the user selects label `tail`, picks the pen tool, and drags across pixels
- **THEN** the dragged pixels SHALL be added to the in-memory `tail` mask and visualized in the tail's overlay color.

#### Scenario: Undo reverts the last stroke

- **WHEN** the user makes 3 pen strokes and clicks undo
- **THEN** only the last stroke SHALL be removed; the first 2 strokes SHALL remain.

#### Scenario: Switching labels does not lose existing masks

- **WHEN** the user paints `tail`, switches to `mouth`, paints `mouth`, then switches back to `tail`
- **THEN** the previously painted `tail` mask SHALL still be present and editable.

### Requirement: Auxiliary mask filters

After every edit, the UI SHALL apply auxiliary filters to the active label's mask before persistence:

- clip-to-source: pixels outside the source's `alpha >= 128` region SHALL be removed from the label.
- hole-fill: connected transparent regions of less than 4 pixels fully enclosed inside a mask region SHALL be filled.
- isolated-pixel-removal: connected mask regions of less than 4 pixels SHALL be removed.

These filters apply to `tail`, `mouth`, and `fin`. They SHALL NOT modify `body` (since body is allowed to span the full opaque silhouette).

#### Scenario: Pen strokes outside silhouette are clipped

- **WHEN** the user paints tail pixels that fall outside the source's opaque region
- **THEN** the persisted `tail.png` SHALL only retain pixels inside the source's `alpha >= 128` region.

#### Scenario: Single isolated pixel is removed

- **WHEN** the user accidentally paints a single isolated pixel of `mouth`
- **THEN** the auxiliary filter SHALL remove that pixel before persistence.

### Requirement: Mask labels may overlap

The annotation UI SHALL allow the same pixel to be assigned to multiple labels. The auxiliary filter SHALL NOT enforce mutual exclusion. The renderer's identification priority `tail > mouth > fin > body` is the authoritative consumer and is defined in the `template-renderer` capability.

#### Scenario: Tail can overlap body

- **WHEN** the user paints `tail` over pixels that are also in `body`
- **THEN** both `body.png` and `tail.png` SHALL retain those pixels as 1.

### Requirement: Per-label grayscale PNG persistence

The UI SHALL persist masks as one grayscale PNG per label at `projects/<project_id>/mask/<label>.png` with the same dimensions as the source. Pixel intensity SHALL be 0 (not the label) or 255 (the label) in the PoC; intermediate values are reserved but unused.

#### Scenario: Save tail mask to file

- **WHEN** the user finishes editing and saves
- **THEN** the server SHALL write `mask/tail.png` as a grayscale PNG with intensity 255 where the label is set and 0 elsewhere.
