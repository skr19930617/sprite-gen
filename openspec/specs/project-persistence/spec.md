# project-persistence Specification

## Purpose

TBD - created by archiving change sprite-generator-mvp. Update Purpose after archive.

## Requirements

### Requirement: Project save artifacts

The system SHALL persist the following artifacts per project to Supabase Storage: `source.png`, `mask.png`, `project.json`, `result.gif`, `spritesheet.png`. The system MUST NOT persist intermediate per-frame buffers or rendering caches.

#### Scenario: Save produces all artifacts

- **WHEN** a user saves a project after a successful generation
- **THEN** all five files are written to Supabase Storage under a per-project path and references are recorded in `project.json`

#### Scenario: No intermediate files persisted

- **WHEN** a project is saved
- **THEN** no per-frame PNGs or intermediate renderer caches are written to Storage

### Requirement: project.json schema

The system SHALL write `project.json` with exactly the following top-level keys: `version`, `entity_type`, `source_image_path`, `mask_image_path`, `prompt`, `llm_result`, `final_animation_type`, `final_params`, `region_palette`, `outputs`, `renderer_version`, `created_at`, `updated_at`. `version` MUST be `1` in MVP. `created_at` / `updated_at` MUST be ISO8601 UTC timestamps.

#### Scenario: project.json has required keys

- **WHEN** a project is saved
- **THEN** `project.json` contains all required top-level keys and no extra keys at the top level

### Requirement: Reproducibility contract

The system SHALL preserve the original `prompt`, the original `llm_result`, and the user-confirmed `final_animation_type` / `final_params` separately so that the user decision is distinguishable from the LLM suggestion.

#### Scenario: LLM result preserved even after override

- **WHEN** a user overrides `animation_type` from "eat" to "swim_slow" before generation
- **THEN** `project.json.llm_result.animation_type` = "eat" and `project.json.final_animation_type` = "swim_slow"

### Requirement: Project list and reload

The system SHALL provide a project list screen where users can see their saved projects, reload any project into the editor, and trigger regeneration with modified masks or params.

#### Scenario: Reload restores state

- **WHEN** a user opens a saved project from the list
- **THEN** the system restores the source image, mask, prompt, LLM result, final params, and previously generated outputs into the editor

### Requirement: Overwrite and duplicate save

The system SHALL support two save modes: overwrite (update existing project) and duplicate (create a new project from current state). Both MUST update `updated_at`; duplicate MUST also set a fresh `created_at` and new project id.

#### Scenario: Overwrite updates existing

- **WHEN** a user opens project A and chooses "上書き保存"
- **THEN** project A's `updated_at` is refreshed and artifacts are replaced in place

#### Scenario: Duplicate creates new

- **WHEN** a user opens project A and chooses "複製保存"
- **THEN** a new project B is created with fresh `created_at` and `updated_at` and copies of A's artifacts

### Requirement: Version compatibility policy

The system SHALL allow open and view for any saved project, but MUST disable regeneration when `renderer_version` in `project.json` does not match the current renderer version. In that case the UI MUST display a warning.

#### Scenario: Same renderer_version allows regeneration

- **WHEN** a user opens a project where `renderer_version` = 1 and the current renderer is version 1
- **THEN** the regenerate button is enabled

#### Scenario: Mismatched renderer_version blocks regeneration

- **WHEN** a user opens a project where `renderer_version` ≠ current renderer version
- **THEN** the regenerate button is disabled and a warning "このプロジェクトは互換性のないレンダラバージョンで作成されました — 読み取り専用です" is displayed
