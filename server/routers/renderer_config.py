"""POST /projects/{id}/renderer-config — second-pass LLM call.

Reads the persisted plan draft, asks the LLM for {renderer_template, args},
runs the plan-template compatibility checks, force-overrides project-derived
fields, and persists the renderer-config draft (server appends loop and
plan_token).
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException

from server.deps import validate_project_id
from sprite_gen import config, project_store
from sprite_gen.llm_client import LlmCliError, invoke_claude
from sprite_gen.project_models import RendererConfigDraft
from sprite_gen.renderer import REGISTERED_TEMPLATES

logger = logging.getLogger("sprite_gen.routers.renderer_config")

router = APIRouter(tags=["renderer-config"])

_FORCED_FIELDS = ("fps", "frames", "output_width", "output_height")


def _build_payload(plan_draft, project_output, mask_labels_present: list[str]) -> dict[str, Any]:
    return {
        "stage": "renderer_config",
        "instructions": (
            "You are sprite-gen's second-pass LLM. Return a single JSON object with exactly two "
            "keys: `renderer_template` and `args`. `renderer_template` MUST match the registered "
            "template for the plan's animation_type. `args` MUST contain numeric keys "
            "tail_amplitude, mouth_open_ratio, body_follow, fps, frames, output_width, "
            "output_height. Do NOT return a top-level `loop` field — loop is server-managed."
        ),
        "source_image_path": "source.png",
        "mask_dir": "mask",
        "output_size": {"w": project_output.width, "h": project_output.height},
        "fps": project_output.fps,
        "frame_count": project_output.frame_count,
        "prompt": plan_draft.prompt,
        "llm_plan": plan_draft.llm_plan,
        "mask_labels_present": mask_labels_present,
    }


def _validate_args_shape(args: dict[str, Any]) -> None:
    required = ("tail_amplitude", "mouth_open_ratio", "body_follow", "fps", "frames", "output_width", "output_height")
    for key in required:
        if key not in args:
            raise HTTPException(
                status_code=422,
                detail={
                    "error_kind": "llm_schema_mismatch",
                    "detail": f"args missing key: {key}",
                    "retriable": True,
                },
            )

    def _check_range(name: str, lo: float, hi: float) -> None:
        v = args[name]
        if not isinstance(v, (int, float)) or isinstance(v, bool):
            raise HTTPException(status_code=422, detail={"error_kind": "args_out_of_range", "detail": f"args.{name} must be numeric", "retriable": True})
        if not (lo <= float(v) <= hi):
            raise HTTPException(status_code=422, detail={"error_kind": "args_out_of_range", "detail": f"args.{name} out of range [{lo},{hi}]: {v}", "retriable": True})

    _check_range("tail_amplitude", 0.0, 1.0)
    _check_range("mouth_open_ratio", 0.0, 1.0)
    _check_range("body_follow", 0.0, 0.5)


def _force_override(args: dict[str, Any], project_output, project_id: str, plan_token: str) -> dict[str, Any]:
    enforced = {
        "fps": project_output.fps,
        "frames": project_output.frame_count,
        "output_width": project_output.width,
        "output_height": project_output.height,
    }
    out = dict(args)
    for field, value in enforced.items():
        llm_value = out.get(field)
        if llm_value != value:
            logger.warning(
                "renderer_config_arg_overridden",
                extra={
                    "event": "renderer_config_arg_overridden",
                    "field": field,
                    "llm_value": llm_value,
                    "enforced_value": value,
                    "project_id": project_id,
                    "plan_token": plan_token,
                },
            )
        out[field] = value
    return out


@router.post("/projects/{project_id}/renderer-config")
async def post_renderer_config(
    project_id: str = Depends(validate_project_id),
    payload: dict[str, Any] = Body(default_factory=dict),
) -> dict[str, Any]:
    if not project_store.project_exists(project_id):
        raise HTTPException(status_code=404, detail="project not found")
    if not project_store.has_plan_draft(project_id):
        raise HTTPException(status_code=404, detail={"error_kind": "no_active_plan_draft", "detail": "POST llm-plan first to create the active draft", "retriable": False})

    plan_draft = project_store.load_plan_draft(project_id)
    proj = project_store.load_project(project_id)
    if proj.output is None:
        raise HTTPException(status_code=500, detail="project missing output settings")

    # 1. Pre-flight: required masks must have content
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

    # 2. Compose LLM input payload (mask_labels_present derived server-side)
    labels_present = project_store.labels_present(project_id)
    prompt_payload = _build_payload(plan_draft, proj.output, labels_present)

    try:
        result = invoke_claude(prompt_payload)
    except LlmCliError as exc:
        raise HTTPException(status_code=exc.http_status, detail=exc.to_response_payload())

    parsed = result.parsed
    # Validate strict shape: only renderer_template + args
    if not isinstance(parsed, dict) or set(parsed.keys()) - {"renderer_template", "args"}:
        raise HTTPException(
            status_code=422,
            detail={
                "error_kind": "llm_schema_mismatch",
                "detail": (
                    "renderer-config response must contain exactly {renderer_template, args}; "
                    f"got keys {sorted(parsed.keys()) if isinstance(parsed, dict) else parsed}"
                ),
                "retriable": True,
            },
        )

    if "renderer_template" not in parsed or "args" not in parsed:
        raise HTTPException(
            status_code=422,
            detail={"error_kind": "llm_schema_mismatch", "detail": "missing renderer_template or args", "retriable": True},
        )

    template_id = parsed["renderer_template"]
    args = parsed["args"]
    if not isinstance(args, dict):
        raise HTTPException(status_code=422, detail={"error_kind": "llm_schema_mismatch", "detail": "args must be an object", "retriable": True})

    # 3. Plan-template compatibility checks (in order)
    expected_template = config.ANIMATION_TYPE_TO_TEMPLATE.get(plan_draft.llm_plan["animation_type"])
    if expected_template is None:
        # Should already have been caught at llm-plan; defense-in-depth
        raise HTTPException(
            status_code=422,
            detail={
                "error_kind": "unsupported_animation_type_for_poc",
                "detail": f"animation_type {plan_draft.llm_plan['animation_type']!r} has no PoC template",
                "retriable": True,
            },
        )
    if template_id not in REGISTERED_TEMPLATES:
        raise HTTPException(
            status_code=422,
            detail={
                "error_kind": "unknown_renderer_template",
                "detail": f"renderer_template {template_id!r} is not registered",
                "retriable": True,
            },
        )
    if template_id != expected_template:
        raise HTTPException(
            status_code=422,
            detail={
                "error_kind": "renderer_template_mismatch_for_plan_animation_type",
                "detail": (
                    f"plan.animation_type={plan_draft.llm_plan['animation_type']!r} expects "
                    f"renderer_template={expected_template!r}; got {template_id!r}"
                ),
                "retriable": True,
            },
        )

    # 4. Args range validation
    _validate_args_shape(args)

    # 5. Force-override project-derived fields (with warning log)
    enforced_args = _force_override(args, proj.output, project_id, plan_draft.plan_token)

    # 6. Persist renderer config draft (server-derived loop + plan_token)
    rc_draft = RendererConfigDraft(
        renderer_template=template_id,
        args=enforced_args,
        loop=bool(plan_draft.params.get("loop", True)),
        plan_token=plan_draft.plan_token,
        created_at=project_store.now_iso(),
    )
    project_store.save_renderer_draft(project_id, rc_draft)

    return {"renderer_config": rc_draft.to_json()}
