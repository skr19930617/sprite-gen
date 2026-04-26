"""POST /projects/{id}/animations and /animations/{id}/re-render.

Both endpoints read the active draft, render to a sibling staging dir under
``animations/.tmp/``, and atomically commit. The re-render path uses
backup-and-replace to swap an existing animation entry in place while keeping
``animation_id`` and ``created_at`` stable.
"""

from __future__ import annotations

import json
import logging
import shutil
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from server.deps import validate_animation_id, validate_project_id
from sprite_gen import project_store
from sprite_gen.project_models import AnimationEntry
from sprite_gen.renderer import (
    REGISTERED_TEMPLATES,
    RenderError,
    RendererArgs,
    UnknownTemplateError,
    render,
)

logger = logging.getLogger("sprite_gen.routers.animations")

router = APIRouter(tags=["animations"])


def _read_drafts_or_404(project_id: str) -> tuple[Any, Any]:
    if not project_store.has_plan_draft(project_id) or not project_store.has_renderer_config_draft(project_id):
        raise HTTPException(
            status_code=404,
            detail={
                "error_kind": "active_draft_incomplete",
                "detail": "both plan and renderer-config drafts are required",
                "retriable": False,
            },
        )
    plan_draft = project_store.load_plan_draft(project_id)
    rc_draft = project_store.load_renderer_draft(project_id)
    if plan_draft.plan_token != rc_draft.plan_token:
        raise HTTPException(
            status_code=409,
            detail={
                "error_kind": "renderer_config_stale",
                "detail": "plan_token mismatch — re-run /renderer-config",
                "retriable": True,
            },
        )
    return plan_draft, rc_draft


def _verify_required_masks(project_id: str, plan_draft) -> None:
    missing = [
        lbl for lbl in plan_draft.llm_plan["required_regions"] if not project_store.mask_has_content(project_id, lbl)
    ]
    if missing:
        raise HTTPException(
            status_code=422,
            detail={
                "error_kind": "required_masks_missing",
                "detail": f"required mask labels missing or empty: {missing}",
                "retriable": True,
                "missing_masks": missing,
            },
        )


def _mask_paths_for_render(project_id: str) -> dict[str, Path | None]:
    paths: dict[str, Path | None] = {}
    for label in ("body", "tail", "mouth", "fin"):
        path = project_store.mask_path(project_id, label)
        paths[label] = path if path.exists() else None
    return paths


def _run_render(project_id: str, plan_draft, rc_draft, animation_id: str) -> Path:
    """Render into staging dir; return the staging path."""
    staging = project_store.animation_staging_dir(project_id, animation_id)
    if staging.exists():
        shutil.rmtree(staging)
    args = RendererArgs.from_json(rc_draft.args)
    proj = project_store.load_project(project_id)
    if proj.output is None:
        raise HTTPException(status_code=500, detail="project missing output settings")
    try:
        render(
            source_image=project_store.source_path(project_id),
            masks=_mask_paths_for_render(project_id),
            template_id=rc_draft.renderer_template,
            args=args,
            loop=rc_draft.loop,
            export_format=proj.output.export_format,
            output_dir=staging,
        )
    except UnknownTemplateError:
        if staging.exists():
            shutil.rmtree(staging)
        raise HTTPException(
            status_code=422,
            detail={
                "error_kind": "unknown_renderer_template",
                "detail": f"renderer template {rc_draft.renderer_template!r} is not registered",
                "retriable": False,
            },
        )
    except RenderError as exc:
        if staging.exists():
            shutil.rmtree(staging)
        raise HTTPException(
            status_code=500,
            detail={
                "error_kind": "render_error",
                "detail": str(exc),
                "retriable": True,
            },
        )

    # Persist renderer_config.json inside the staging dir (will be moved into final on rename)
    rc_data = rc_draft.to_json()
    (staging / "renderer_config.json").write_text(json.dumps(rc_data, indent=2))
    return staging


def _build_entry(
    project_id: str,
    plan_draft,
    rc_draft,
    animation_id: str,
    created_at: str,
    updated_at: str,
) -> AnimationEntry:
    proj = project_store.load_project(project_id)
    if proj.output is None:
        raise HTTPException(status_code=500, detail="project missing output settings")
    fmt = proj.output.export_format
    gif_rel = f"animations/{animation_id}/result.gif" if fmt in ("gif", "both") else None
    sheet_rel = f"animations/{animation_id}/spritesheet.png" if fmt in ("spritesheet", "both") else None
    return AnimationEntry(
        animation_id=animation_id,
        prompt=plan_draft.prompt,
        llm_plan=plan_draft.llm_plan,
        params=dict(plan_draft.params),
        annotation={"labels_present": project_store.labels_present(project_id)},
        renderer_config_path=f"animations/{animation_id}/renderer_config.json",
        outputs={"gif_path": gif_rel, "spritesheet_path": sheet_rel},
        renderer_version=1,
        created_at=created_at,
        updated_at=updated_at,
    )


@router.post("/projects/{project_id}/animations")
async def commit_animation(project_id: str = Depends(validate_project_id)) -> dict[str, Any]:
    if not project_store.project_exists(project_id):
        raise HTTPException(status_code=404, detail="project not found")
    plan_draft, rc_draft = _read_drafts_or_404(project_id)
    _verify_required_masks(project_id, plan_draft)

    animation_id = project_store.new_id_slug()
    staging = _run_render(project_id, plan_draft, rc_draft, animation_id)
    final_dir = project_store.animation_dir(project_id, animation_id)
    if final_dir.exists():
        shutil.rmtree(final_dir)
    final_dir.parent.mkdir(parents=True, exist_ok=True)
    staging.rename(final_dir)

    ts = project_store.now_iso()
    entry = _build_entry(project_id, plan_draft, rc_draft, animation_id, ts, ts)
    proj = project_store.load_project(project_id)
    proj.animations.append(entry)
    project_store.save_project(proj)

    project_store.clear_active_draft(project_id)

    return {"animation": entry.to_json()}


@router.post("/projects/{project_id}/animations/{animation_id}/re-render")
async def re_render_animation(
    project_id: str = Depends(validate_project_id),
    animation_id: str = Depends(validate_animation_id),
) -> dict[str, Any]:
    if not project_store.project_exists(project_id):
        raise HTTPException(status_code=404, detail="project not found")
    proj = project_store.load_project(project_id)
    existing = next((a for a in proj.animations if a.animation_id == animation_id), None)
    if existing is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error_kind": "animation_not_found",
                "detail": f"animation {animation_id!r} not in project",
                "retriable": False,
            },
        )

    plan_draft, rc_draft = _read_drafts_or_404(project_id)
    _verify_required_masks(project_id, plan_draft)

    staging = _run_render(project_id, plan_draft, rc_draft, animation_id)
    final_dir = project_store.animation_dir(project_id, animation_id)
    backup_dir = project_store.animation_backup_dir(project_id, animation_id)

    # Backup-and-replace swap (POSIX-safe)
    if backup_dir.exists():
        shutil.rmtree(backup_dir)
    if final_dir.exists():
        final_dir.rename(backup_dir)
    try:
        staging.rename(final_dir)
    except OSError:
        # Restore from backup on failure
        if backup_dir.exists() and not final_dir.exists():
            backup_dir.rename(final_dir)
        raise HTTPException(
            status_code=500,
            detail={
                "error_kind": "render_commit_failed",
                "detail": "could not place new animation directory",
                "retriable": True,
            },
        )
    if backup_dir.exists():
        shutil.rmtree(backup_dir)

    # Update entry in place
    ts = project_store.now_iso()
    existing.params = dict(plan_draft.params)
    existing.llm_plan = plan_draft.llm_plan
    existing.prompt = plan_draft.prompt
    existing.annotation = {"labels_present": project_store.labels_present(project_id)}
    if proj.output is None:
        raise HTTPException(status_code=500, detail="project missing output settings")
    fmt = proj.output.export_format
    existing.outputs = {
        "gif_path": f"animations/{animation_id}/result.gif" if fmt in ("gif", "both") else None,
        "spritesheet_path": f"animations/{animation_id}/spritesheet.png" if fmt in ("spritesheet", "both") else None,
    }
    existing.updated_at = ts
    project_store.save_project(proj)

    project_store.clear_active_draft(project_id)
    return {"animation": existing.to_json()}
