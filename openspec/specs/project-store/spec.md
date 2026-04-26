# project-store Specification

## Purpose
TBD - created by archiving change sprite-gen-poc. Update Purpose after archive.
## Requirements
### Requirement: Project directory layout

Each project SHALL be persisted under `./projects/<project_id>/` (relative to the repository root). The `projects/` directory SHALL be excluded from git via `.gitignore`. The layout for a project SHALL be:

```
projects/<project_id>/
  source.png
  mask/
    body.png
    tail.png      (created lazily; absent if user never painted)
    mouth.png     (created lazily)
    fin.png       (created lazily)
  project.json
  animations/
    <animation_id>/
      renderer_config.json
      result.gif         (when export_format includes gif)
      spritesheet.png    (when export_format includes spritesheet)
```

`<project_id>` and `<animation_id>` SHALL be URL-safe slugs (`[a-z0-9-]+`).

#### Scenario: New project creates expected directory structure

- **WHEN** a user uploads a source PNG to start a new project
- **THEN** the server SHALL create `projects/<project_id>/source.png`, an empty `mask/` directory containing `body.png`, an empty `animations/` directory, and `project.json` with `version=3` and `animations: []`.

#### Scenario: projects/ excluded from git

- **WHEN** a project directory is created
- **THEN** the repository's `.gitignore` SHALL contain `projects/` so the directory is not tracked.

### Requirement: project.json v3 schema

The project descriptor `project.json` SHALL conform to version 3 of the schema:

```
{
  "version": 3,
  "project_id": "<slug>",
  "entity_type": "fish",
  "source_image_path": "source.png",
  "mask_dir": "mask",
  "output": {
    "width": <int>,
    "height": <int>,
    "fps": <int>,
    "frame_count": <int>,
    "export_format": "gif" | "spritesheet" | "both"
  },
  "animations": [
    {
      "animation_id": "<slug>",
      "prompt": "<original natural-language prompt>",
      "llm_plan": { /* schema from llm-plan-analysis */ },
      "params": { /* resolved + user-edited params */ },
      "annotation": { "labels_present": ["body","tail","mouth"] },
      "renderer_config_path": "animations/<animation_id>/renderer_config.json",
      "outputs": {
        "gif_path":         "animations/<animation_id>/result.gif",
        "spritesheet_path": "animations/<animation_id>/spritesheet.png"
      },
      "renderer_version": 1,
      "created_at": "<ISO8601 UTC>",
      "updated_at": "<ISO8601 UTC>"
    }
  ],
  "created_at": "<ISO8601 UTC>",
  "updated_at": "<ISO8601 UTC>"
}
```

`outputs.gif_path` SHALL be `null` when `export_format=spritesheet`, and `outputs.spritesheet_path` SHALL be `null` when `export_format=gif`.

#### Scenario: project.json starts with empty animations

- **WHEN** a brand-new project is created
- **THEN** `project.json.animations` SHALL be `[]` and `version` SHALL be 3.

#### Scenario: Successful render appends to animations

- **WHEN** the user generates a `swim_slow` animation that completes successfully
- **THEN** the server SHALL append a new entry to `animations[]` with the resolved plan, params, and output paths, and SHALL update `project.json.updated_at`.

### Requirement: Project listing, reload, and duplicate-save

The server SHALL expose endpoints / actions allowing the UI to:

- list saved projects (each entry returns `project_id`, source thumbnail data, `animations[].animation_type` summary, and timestamps).
- reload a project by `project_id` and resume editing — the UI SHALL be able to add new animations to it.
- duplicate-save a project under a new `project_id`, copying `source.png` and the entire `mask/` directory but starting with `animations: []`.

#### Scenario: Reload restores source, masks, and animation list

- **WHEN** the user opens a previously saved project
- **THEN** the server SHALL return the source image, all label masks present in `mask/`, and the full `animations[]` list with output asset references.

#### Scenario: Duplicate-save preserves source and masks but resets animations

- **WHEN** the user picks "Duplicate save" on a project containing 2 animations
- **THEN** the new project directory SHALL contain the same `source.png` and `mask/*.png` files but `project.json.animations=[]`, leaving the original project untouched.

### Requirement: Failed LLM call does not append animation entry

When an LLM-renderer-config invocation fails (per `llm-renderer-config` failure handling), the server SHALL NOT append an entry to `animations[]` and SHALL NOT create an `animations/<animation_id>/` directory. The user's source, output conditions, masks, and the failed prompt SHALL remain in their pre-call state so a retry uses the same inputs.

#### Scenario: Failed LLM call leaves project untouched

- **WHEN** the user submits a prompt and the LLM call times out
- **THEN** `project.json.animations` SHALL remain at its prior length, no new `animations/<animation_id>/` directory SHALL exist, and the source / masks SHALL remain unchanged.

