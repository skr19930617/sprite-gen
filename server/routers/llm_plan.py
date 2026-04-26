"""POST /projects/{id}/llm-plan — first-pass LLM call + draft persistence."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException

from server.deps import validate_project_id
from sprite_gen import project_store
from sprite_gen.llm_client import LlmCliError, invoke_claude
from sprite_gen.llm_plan import (
    PlanValidationError,
    check_poc_supported,
    validate_and_normalize_plan,
)
from sprite_gen.project_models import PlanDraft

router = APIRouter(tags=["llm-plan"])


def _build_plan_prompt(prompt: str, output_settings: dict[str, Any]) -> dict[str, Any]:
    return {
        "stage": "llm_plan",
        "instructions": (
            "You are sprite-gen's first-pass LLM. Return a single JSON object matching the "
            "fixed schema with keys entity_type, animation_type, required_regions, "
            "optional_regions, params, annotation_schema. animation_type ∈ {swim_slow, turn, "
            "approach_food, eat}. Region labels ∈ {body, tail, mouth, fin}. params keys: "
            "speed (slow|medium), amplitude (small|medium), emphasis (none|tail|mouth|fin), "
            "loop (bool). DO NOT wrap the response in an animations[] array."
        ),
        "user_prompt": prompt,
        "output_settings": output_settings,
    }


@router.post("/projects/{project_id}/llm-plan")
async def post_llm_plan(
    project_id: str = Depends(validate_project_id),
    payload: dict[str, Any] = Body(...),
) -> dict[str, Any]:
    if not project_store.project_exists(project_id):
        raise HTTPException(status_code=404, detail="project not found")
    prompt = payload.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise HTTPException(
            status_code=400,
            detail={
                "error_kind": "missing_prompt",
                "detail": "prompt is required",
                "retriable": False,
            },
        )

    proj = project_store.load_project(project_id)
    output_dict = proj.output.to_json() if proj.output else {}

    try:
        result = invoke_claude(_build_plan_prompt(prompt, output_dict))
    except LlmCliError as exc:
        raise HTTPException(status_code=exc.http_status, detail=exc.to_response_payload())

    try:
        normalized = validate_and_normalize_plan(result.parsed)
        check_poc_supported(normalized)
    except PlanValidationError as exc:
        raise HTTPException(status_code=exc.http_status, detail=exc.to_response_payload())

    missing = [
        lbl
        for lbl in normalized["required_regions"]
        if not project_store.mask_has_content(project_id, lbl)
    ]

    # Renderer-config invalidation: a new plan deletes any prior renderer draft.
    project_store.delete_renderer_draft(project_id)

    plan_token = project_store.new_plan_token()
    draft = PlanDraft(
        prompt=prompt,
        llm_plan=normalized,
        params=dict(normalized["params"]),
        missing_masks=list(missing),
        plan_token=plan_token,
        created_at=project_store.now_iso(),
    )
    project_store.save_plan_draft(project_id, draft)

    return {
        "resolved_plan": normalized,
        "missing_masks": missing,
        "plan_token": plan_token,
    }
