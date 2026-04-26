"""Shared FastAPI path-parameter validators.

Every route that accepts ``project_id``, ``animation_id``, or ``label`` MUST
use these dependencies so invalid IDs are rejected with 400 BEFORE filesystem
resolution. Centralizing keeps the slug regex (``config.SLUG_PATTERN``) and
the label vocabulary (``config.LABELS``) authoritative.
"""

from __future__ import annotations

from fastapi import HTTPException, Path

from sprite_gen import config
from sprite_gen.project_models import is_valid_label, is_valid_slug


def validate_project_id(project_id: str = Path(..., description="Project slug")) -> str:
    if not is_valid_slug(project_id):
        raise HTTPException(
            status_code=400,
            detail={
                "error_kind": "invalid_project_id",
                "detail": (
                    f"project_id must match {config.SLUG_PATTERN!r}; "
                    f"received {project_id!r}"
                ),
                "retriable": False,
            },
        )
    return project_id


def validate_animation_id(animation_id: str = Path(..., description="Animation slug")) -> str:
    if not is_valid_slug(animation_id):
        raise HTTPException(
            status_code=400,
            detail={
                "error_kind": "invalid_animation_id",
                "detail": (
                    f"animation_id must match {config.SLUG_PATTERN!r}; "
                    f"received {animation_id!r}"
                ),
                "retriable": False,
            },
        )
    return animation_id


def validate_label(label: str = Path(..., description="Mask label")) -> str:
    if not is_valid_label(label):
        raise HTTPException(
            status_code=400,
            detail={
                "error_kind": "invalid_mask_label",
                "detail": (
                    f"label must be one of {config.LABELS}; received {label!r}"
                ),
                "retriable": False,
            },
        )
    return label
