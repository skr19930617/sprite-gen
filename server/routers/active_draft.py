"""Active-draft management endpoints.

PATCH /projects/{id}/active-draft/params         — edit plan.params
PATCH /projects/{id}/active-draft/renderer-config — edit args (only)
DELETE /projects/{id}/active-draft               — clear both drafts
POST /projects/{id}/active-draft/seed-from/{animation_id}
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from server.deps import validate_animation_id, validate_project_id
from sprite_gen import config, project_store
from sprite_gen.llm_plan import LABELS  # noqa: F401  (re-exported)
from sprite_gen.project_models import PlanDraft, RendererConfigDraft

router = APIRouter(tags=["active-draft"])


@router.delete("/projects/{project_id}/active-draft", status_code=204)
async def delete_active_draft(project_id: str = Depends(validate_project_id)) -> None:
    if not project_store.project_exists(project_id):
        raise HTTPException(status_code=404, detail="project not found")
    project_store.clear_active_draft(project_id)
    return None


@router.patch("/projects/{project_id}/active-draft/params")
async def patch_active_draft_params(
    project_id: str = Depends(validate_project_id),
    payload: dict[str, Any] = Body(...),
) -> dict[str, Any]:
    if not project_store.has_plan_draft(project_id):
        raise HTTPException(status_code=404, detail={"error_kind": "no_active_plan_draft", "detail": "no active plan draft to update", "retriable": False})

    raw = payload.get("params")
    if not isinstance(raw, dict):
        raise HTTPException(
            status_code=400,
            detail={"error_kind": "invalid_params_payload", "detail": "params object required", "retriable": False},
        )

    speed = raw.get("speed", "slow")
    if speed not in ("slow", "medium"):
        raise HTTPException(status_code=400, detail={"error_kind": "invalid_params", "detail": f"params.speed invalid: {speed!r}", "retriable": False})
    amplitude = raw.get("amplitude", "small")
    if amplitude not in ("small", "medium"):
        raise HTTPException(status_code=400, detail={"error_kind": "invalid_params", "detail": f"params.amplitude invalid: {amplitude!r}", "retriable": False})
    emphasis = raw.get("emphasis", "none")
    if emphasis not in ("none", "tail", "mouth", "fin"):
        raise HTTPException(status_code=400, detail={"error_kind": "invalid_params", "detail": f"params.emphasis invalid: {emphasis!r}", "retriable": False})
    loop = raw.get("loop", True)
    if not isinstance(loop, bool):
        raise HTTPException(status_code=400, detail={"error_kind": "invalid_params", "detail": "params.loop must be bool", "retriable": False})

    draft = project_store.load_plan_draft(project_id)
    draft.params = {"speed": speed, "amplitude": amplitude, "emphasis": emphasis, "loop": loop}
    project_store.save_plan_draft(project_id, draft)

    # Param edits invalidate the renderer config draft (per design.md "loop propagation" rule).
    project_store.delete_renderer_draft(project_id)

    return {"plan": draft.to_json()}


@router.patch("/projects/{project_id}/active-draft/renderer-config")
async def patch_active_draft_renderer_config(
    project_id: str = Depends(validate_project_id),
    payload: dict[str, Any] = Body(...),
) -> dict[str, Any]:
    if not project_store.has_renderer_config_draft(project_id):
        raise HTTPException(status_code=404, detail={"error_kind": "no_active_renderer_config_draft", "detail": "no active renderer config draft to update", "retriable": False})

    forbidden = [k for k in ("renderer_template", "plan_token", "loop") if k in payload]
    if forbidden:
        raise HTTPException(
            status_code=400,
            detail={
                "error_kind": "forbidden_keys_in_renderer_config_patch",
                "detail": (
                    f"keys {forbidden} are server-managed; loop is authoritative in params, "
                    f"renderer_template / plan_token are server-derived"
                ),
                "retriable": False,
            },
        )

    args = payload.get("args")
    if not isinstance(args, dict):
        raise HTTPException(
            status_code=400,
            detail={"error_kind": "invalid_args_payload", "detail": "args object required", "retriable": False},
        )

    draft = project_store.load_renderer_draft(project_id)
    merged = dict(draft.args)
    merged.update(args)
    _validate_args_ranges(merged)
    draft.args = merged
    project_store.save_renderer_draft(project_id, draft)
    return {"renderer_config": draft.to_json()}


def _validate_args_ranges(args: dict[str, Any]) -> None:
    def _f(name: str, lo: float, hi: float) -> None:
        v = args.get(name)
        if not isinstance(v, (int, float)) or isinstance(v, bool):
            raise HTTPException(status_code=400, detail={"error_kind": "invalid_args", "detail": f"args.{name} must be numeric", "retriable": False})
        if not (lo <= float(v) <= hi):
            raise HTTPException(status_code=400, detail={"error_kind": "invalid_args", "detail": f"args.{name} out of range [{lo},{hi}]: {v}", "retriable": False})

    _f("tail_amplitude", 0.0, 1.0)
    _f("mouth_open_ratio", 0.0, 1.0)
    _f("body_follow", 0.0, 0.5)


@router.post("/projects/{project_id}/active-draft/seed-from/{animation_id}")
async def seed_from_animation(
    project_id: str = Depends(validate_project_id),
    animation_id: str = Depends(validate_animation_id),
    overwrite: bool = Query(False),
) -> dict[str, Any]:
    if not project_store.project_exists(project_id):
        raise HTTPException(status_code=404, detail="project not found")

    proj = project_store.load_project(project_id)
    entry = next((a for a in proj.animations if a.animation_id == animation_id), None)
    if entry is None:
        raise HTTPException(status_code=404, detail={"error_kind": "animation_not_found", "detail": f"no animation {animation_id!r} in project", "retriable": False})

    if (project_store.has_plan_draft(project_id) or project_store.has_renderer_config_draft(project_id)) and not overwrite:
        raise HTTPException(
            status_code=409,
            detail={
                "error_kind": "draft_already_present",
                "detail": "active draft already exists; pass ?overwrite=true to replace",
                "retriable": True,
            },
        )

    rc_path = project_store.project_dir(project_id) / entry.renderer_config_path
    if not rc_path.exists():
        raise HTTPException(status_code=404, detail={"error_kind": "renderer_config_missing", "detail": f"renderer_config.json not found for animation {animation_id}", "retriable": False})
    rc_data = project_store.read_json(rc_path)

    new_token = project_store.new_plan_token()
    plan_draft = PlanDraft(
        prompt=entry.prompt,
        llm_plan=entry.llm_plan,
        params=dict(entry.params),
        missing_masks=[],  # masks already exist (entry implies render succeeded)
        plan_token=new_token,
        created_at=project_store.now_iso(),
    )
    project_store.save_plan_draft(project_id, plan_draft)

    rc_draft = RendererConfigDraft(
        renderer_template=rc_data["renderer_template"],
        args=dict(rc_data["args"]),
        loop=bool(rc_data.get("loop", entry.params.get("loop", True))),
        plan_token=new_token,
        created_at=project_store.now_iso(),
    )
    project_store.save_renderer_draft(project_id, rc_draft)

    return {
        "plan": plan_draft.to_json(),
        "renderer_config": rc_draft.to_json(),
    }
