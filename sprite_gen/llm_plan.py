"""LLM plan validation, default-filling, and PoC gating helpers."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from sprite_gen import config

ANIMATION_TYPES = ("swim_slow", "turn", "approach_food", "eat")
LABELS = config.LABELS

DEFAULT_EMPHASIS_PER_TYPE: dict[str, str] = {
    "swim_slow": "tail",
    "eat": "mouth",
    "turn": "tail",
    "approach_food": "tail",
}


class PlanValidationError(Exception):
    """Raised when the LLM plan is structurally invalid or PoC-unsupported.

    ``error_kind`` is one of:
      - llm_schema_mismatch
      - unsupported_animation_type_for_poc
    """

    def __init__(self, error_kind: str, detail: str, http_status: int = 422) -> None:
        super().__init__(detail)
        self.error_kind = error_kind
        self.detail = detail
        self.http_status = http_status

    def to_response_payload(self) -> dict[str, Any]:
        return {
            "error_kind": self.error_kind,
            "detail": self.detail,
            "retriable": True,
        }


def _expect_keys(d: dict[str, Any], required: tuple[str, ...]) -> None:
    missing = [k for k in required if k not in d]
    if missing:
        raise PlanValidationError(
            "llm_schema_mismatch",
            f"plan missing required keys: {missing}",
        )


def validate_and_normalize_plan(raw: dict[str, Any]) -> dict[str, Any]:
    """Strict structural validation + default filling.

    Spec language ("schema validates 4 enum values") is honored at this stage —
    PoC scope gating happens in ``check_poc_supported`` so callers can fail
    fast in llm-plan and defense-in-depth in renderer-config.
    """
    if "animations" in raw and isinstance(raw.get("animations"), list):
        if len(raw["animations"]) > 1:
            raise PlanValidationError(
                "llm_schema_mismatch",
                "LLM returned multiple animations; this PoC accepts exactly one per llm-plan call",
            )

    plan = deepcopy(raw)
    _expect_keys(
        plan,
        ("entity_type", "animation_type", "required_regions", "optional_regions", "params", "annotation_schema"),
    )

    if plan["entity_type"] != "fish":
        raise PlanValidationError(
            "llm_schema_mismatch",
            f"entity_type must be 'fish'; got {plan['entity_type']!r}",
        )

    animation_type = plan["animation_type"]
    if animation_type not in ANIMATION_TYPES:
        raise PlanValidationError(
            "llm_schema_mismatch",
            f"animation_type must be one of {ANIMATION_TYPES}; got {animation_type!r}",
        )

    for key in ("required_regions", "optional_regions"):
        if not isinstance(plan[key], list):
            raise PlanValidationError(
                "llm_schema_mismatch",
                f"{key} must be a list",
            )
        for label in plan[key]:
            if label not in LABELS:
                raise PlanValidationError(
                    "llm_schema_mismatch",
                    f"{key} contains invalid label {label!r}; allowed: {LABELS}",
                )

    params = plan.get("params") or {}
    if not isinstance(params, dict):
        raise PlanValidationError("llm_schema_mismatch", "params must be an object")

    # Default-fill missing/null params per spec
    speed = params.get("speed") or "slow"
    if speed not in ("slow", "medium"):
        raise PlanValidationError("llm_schema_mismatch", f"params.speed invalid: {speed!r}")
    amplitude = params.get("amplitude") or "small"
    if amplitude not in ("small", "medium"):
        raise PlanValidationError("llm_schema_mismatch", f"params.amplitude invalid: {amplitude!r}")
    emphasis = params.get("emphasis")
    if emphasis is None:
        emphasis = DEFAULT_EMPHASIS_PER_TYPE[animation_type]
    if emphasis not in ("none", "tail", "mouth", "fin"):
        raise PlanValidationError("llm_schema_mismatch", f"params.emphasis invalid: {emphasis!r}")
    loop = params.get("loop")
    if loop is None:
        loop = True
    if not isinstance(loop, bool):
        raise PlanValidationError("llm_schema_mismatch", f"params.loop must be bool; got {type(loop).__name__}")

    plan["params"] = {
        "speed": speed,
        "amplitude": amplitude,
        "emphasis": emphasis,
        "loop": loop,
    }

    if not isinstance(plan["annotation_schema"], list):
        raise PlanValidationError("llm_schema_mismatch", "annotation_schema must be a list")

    return plan


def check_poc_supported(plan: dict[str, Any]) -> None:
    """Fail-fast for animation_types with no PoC template.

    Raises ``PlanValidationError`` with ``unsupported_animation_type_for_poc``
    when the resolved animation_type maps to ``None`` in
    ``ANIMATION_TYPE_TO_TEMPLATE``.
    """
    animation_type = plan["animation_type"]
    template = config.ANIMATION_TYPE_TO_TEMPLATE.get(animation_type)
    if template is None:
        supported = [k for k, v in config.ANIMATION_TYPE_TO_TEMPLATE.items() if v is not None]
        raise PlanValidationError(
            "unsupported_animation_type_for_poc",
            f"animation_type {animation_type!r} has no PoC template (supported: {sorted(supported)})",
        )
