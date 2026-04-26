"""Mask upload endpoints.

POST /projects/{id}/masks/{label} accepts a grayscale PNG, validates the mode
and source-size matching, applies per-label cleanup filters server-side, and
persists the filter-applied bytes. Response carries the post-filter mask URL
so the canvas can reload immediately (per spec mask-annotation-ui).
"""

from __future__ import annotations

import io

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Request
from PIL import Image

from server.deps import validate_label, validate_project_id
from sprite_gen import config, project_store

router = APIRouter(tags=["masks"])


@router.post("/projects/{project_id}/masks/{label}")
async def upload_mask(
    request: Request,
    project_id: str = Depends(validate_project_id),
    label: str = Depends(validate_label),
) -> dict:
    if not project_store.project_exists(project_id):
        raise HTTPException(status_code=404, detail="project not found")

    raw = await request.body()
    if not raw:
        raise HTTPException(
            status_code=400,
            detail={
                "error_kind": "empty_mask_payload",
                "detail": "request body must contain mask PNG bytes",
                "retriable": False,
            },
        )
    if len(raw) > config.MAX_FILE_BYTES:
        raise HTTPException(
            status_code=400,
            detail={
                "error_kind": "file_too_large",
                "detail": f"mask exceeds {config.MAX_FILE_BYTES} bytes",
                "retriable": False,
            },
        )

    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=400,
            detail={
                "error_kind": "invalid_png",
                "detail": f"could not decode PNG: {exc}",
                "retriable": False,
            },
        )

    if img.format != "PNG":
        raise HTTPException(
            status_code=400,
            detail={
                "error_kind": "non_png",
                "detail": "only PNG is supported",
                "retriable": False,
            },
        )

    # Accept "L" or "1"; convert RGB / RGBA → L (luminosity)
    if img.mode not in ("L", "1"):
        if img.mode in ("RGB", "RGBA"):
            img = img.convert("L")
        else:
            raise HTTPException(
                status_code=400,
                detail={
                    "error_kind": "unsupported_mask_mode",
                    "detail": f"mask must be grayscale or convertible to L; got {img.mode!r}",
                    "retriable": False,
                },
            )

    # Verify size matches source
    src_path = project_store.source_path(project_id)
    if src_path.exists():
        src_size = Image.open(src_path).size
        if img.size != src_size:
            raise HTTPException(
                status_code=400,
                detail={
                    "error_kind": "mask_size_mismatch",
                    "detail": f"mask size {img.size} does not match source size {src_size}",
                    "retriable": False,
                },
            )

    arr = np.array(img.convert("L"), dtype=np.uint8)
    persisted_path, has_content = project_store.write_mask_bytes(project_id, label, arr)

    mask_url = f"/projects/{project_id}/static/mask/{label}.png"
    return {
        "label": label,
        "persisted_path": str(persisted_path.relative_to(project_store.project_dir(project_id))),
        "dims": {"w": img.width, "h": img.height},
        "mask_url": mask_url,
        "has_content": has_content,
    }
