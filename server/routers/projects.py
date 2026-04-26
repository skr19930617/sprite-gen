"""Project CRUD: create / list / detail / duplicate / delete."""

from __future__ import annotations

import io
import json
import logging
from typing import Any

import numpy as np
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError

from server.deps import validate_project_id
from sprite_gen import config, project_store
from sprite_gen.project_models import ProjectOutput

logger = logging.getLogger("sprite_gen.routers.projects")

router = APIRouter(tags=["projects"])


# ---------------------------------------------------------------------------
# Output settings validation
# ---------------------------------------------------------------------------


def _validate_output_settings(payload: dict[str, Any]) -> ProjectOutput:
    required = ("width", "height", "fps", "frame_count", "export_format")
    missing = [k for k in required if k not in payload]
    if missing:
        raise HTTPException(
            status_code=400,
            detail={
                "error_kind": "missing_output_field",
                "detail": f"missing required output settings: {missing}",
                "retriable": False,
            },
        )

    def _int_in_range(name: str, value: Any, lo: int, hi: int) -> int:
        if not isinstance(value, int) or isinstance(value, bool):
            raise HTTPException(
                status_code=400,
                detail={
                    "error_kind": f"invalid_{name}",
                    "detail": f"{name} must be an integer; got {type(value).__name__}",
                    "retriable": False,
                },
            )
        if not (lo <= value <= hi):
            raise HTTPException(
                status_code=400,
                detail={
                    "error_kind": f"invalid_{name}",
                    "detail": f"{name} must be between {lo} and {hi} inclusive; got {value}",
                    "retriable": False,
                },
            )
        return value

    width = _int_in_range("output_width", payload["width"], *config.OUTPUT_WIDTH_RANGE)
    height = _int_in_range("output_height", payload["height"], *config.OUTPUT_HEIGHT_RANGE)
    fps = _int_in_range("fps", payload["fps"], *config.FPS_RANGE)
    frame_count = _int_in_range("frame_count", payload["frame_count"], *config.FRAME_COUNT_RANGE)
    export_format = payload["export_format"]
    if export_format not in config.EXPORT_FORMATS:
        raise HTTPException(
            status_code=400,
            detail={
                "error_kind": "invalid_export_format",
                "detail": f"export_format must be one of {config.EXPORT_FORMATS}; got {export_format!r}",
                "retriable": False,
            },
        )

    return ProjectOutput(
        width=width,
        height=height,
        fps=fps,
        frame_count=frame_count,
        export_format=export_format,
    )


# ---------------------------------------------------------------------------
# PNG validation + RGBA normalization
# ---------------------------------------------------------------------------


def _normalize_png_to_rgba(raw: bytes) -> tuple[Image.Image, bool]:
    """Return (RGBA image, color_mode_converted). Raises HTTPException for bad input."""
    if len(raw) > config.MAX_FILE_BYTES:
        raise HTTPException(
            status_code=400,
            detail={
                "error_kind": "file_too_large",
                "detail": f"PNG exceeds {config.MAX_FILE_BYTES} bytes",
                "retriable": False,
            },
        )

    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except (UnidentifiedImageError, OSError) as exc:
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

    if img.width > config.MAX_IMAGE_WIDTH or img.height > config.MAX_IMAGE_HEIGHT:
        raise HTTPException(
            status_code=400,
            detail={
                "error_kind": "image_too_large",
                "detail": (
                    f"image dimensions exceed {config.MAX_IMAGE_WIDTH}x{config.MAX_IMAGE_HEIGHT}; "
                    f"got {img.width}x{img.height}"
                ),
                "retriable": False,
            },
        )

    converted = False
    if img.mode == "RGBA":
        return img, converted
    if img.mode == "RGB":
        rgba = img.convert("RGBA")
        return rgba, True
    if img.mode == "L":
        rgba = img.convert("RGB").convert("RGBA")
        return rgba, True
    raise HTTPException(
        status_code=400,
        detail={
            "error_kind": "unsupported_color_mode",
            "detail": f"unsupported color mode {img.mode!r}; expected RGBA / RGB / L",
            "retriable": False,
        },
    )


# ---------------------------------------------------------------------------
# Body initialization
# ---------------------------------------------------------------------------


def _initialize_body_mask(rgba_image: Image.Image, color_mode_converted: bool) -> np.ndarray:
    """Return a 2D uint8 mask with 255 where the source is opaque."""
    arr = np.array(rgba_image)
    alpha = arr[:, :, 3]
    if color_mode_converted:
        # Converted RGB / grayscale → all alpha = 255 → fully-opaque body
        return np.full(alpha.shape, 255, dtype=np.uint8)
    body = np.where(alpha >= config.BODY_ALPHA_THRESHOLD, 255, 0).astype(np.uint8)
    return body


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post("/projects")
async def create_project(
    source: UploadFile = File(...),
    output: str = Form(...),
) -> dict[str, Any]:
    raw = await source.read()
    img, color_mode_converted = _normalize_png_to_rgba(raw)
    try:
        output_payload = json.loads(output)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "error_kind": "invalid_output_json",
                "detail": f"could not parse `output` form field as JSON: {exc}",
                "retriable": False,
            },
        )
    output_settings = _validate_output_settings(output_payload)

    project_id = project_store.new_id_slug()
    project_store.create_project(project_id, output_settings)

    # Persist source.png as RGBA
    src_path = project_store.source_path(project_id)
    img.save(src_path, format="PNG")

    # Initialize body.png
    body_arr = _initialize_body_mask(img, color_mode_converted)
    project_store.write_mask_bytes(project_id, "body", body_arr)

    return {
        "project_id": project_id,
        "source_dim": {"w": img.width, "h": img.height},
        "output": output_settings.to_json(),
        "color_mode_converted": color_mode_converted,
    }


@router.get("/projects/{project_id}")
async def get_project(project_id: str = Depends(validate_project_id)) -> dict[str, Any]:
    if not project_store.project_exists(project_id):
        raise HTTPException(status_code=404, detail="project not found")
    proj = project_store.load_project(project_id)

    base = f"/projects/{project_id}/static"
    masks: dict[str, str] = {}
    for label in config.LABELS:
        if project_store.mask_path(project_id, label).exists():
            masks[label] = f"{base}/mask/{label}.png"

    mask_presence = {label: project_store.mask_has_content(project_id, label) for label in config.LABELS}

    # Active draft state
    active_draft: dict[str, Any] = {
        "has_plan": project_store.has_plan_draft(project_id),
        "has_renderer_config": project_store.has_renderer_config_draft(project_id),
    }
    if active_draft["has_plan"]:
        active_draft["plan"] = project_store.load_plan_draft(project_id).to_json()
    if active_draft["has_renderer_config"]:
        active_draft["renderer_config"] = project_store.load_renderer_draft(project_id).to_json()

    # Hydrate animations with inlined renderer_config + URL forms of outputs
    animations_out: list[dict[str, Any]] = []
    for entry in proj.animations:
        entry_json = entry.to_json()
        rc_path = project_store.project_dir(project_id) / entry.renderer_config_path
        renderer_config = None
        if rc_path.exists():
            renderer_config = project_store.read_json(rc_path)
        gif_url = f"{base}/animations/{entry.animation_id}/result.gif" if entry.outputs.get("gif_path") else None
        spritesheet_url = (
            f"{base}/animations/{entry.animation_id}/spritesheet.png"
            if entry.outputs.get("spritesheet_path")
            else None
        )
        entry_json["renderer_config"] = renderer_config
        entry_json["outputs_urls"] = {"gif_url": gif_url, "spritesheet_url": spritesheet_url}
        animations_out.append(entry_json)

    return {
        "project_id": proj.project_id,
        "schema_version": "v3",
        "entity_type": proj.entity_type,
        "source_url": f"{base}/source.png",
        "masks": masks,
        "mask_dir": proj.mask_dir,
        "output": proj.output.to_json() if proj.output else None,
        "animations": animations_out,
        "mask_presence": mask_presence,
        "active_draft": active_draft,
        "created_at": proj.created_at,
        "updated_at": proj.updated_at,
    }


@router.get("/projects")
async def list_projects() -> dict[str, Any]:
    """Return a summary of every persisted project, ordered by updated_at desc."""
    summaries: list[dict[str, Any]] = []
    for pid in project_store.list_project_ids():
        try:
            proj = project_store.load_project(pid)
        except project_store.ProjectNotFoundError:
            continue
        summaries.append(
            {
                "project_id": proj.project_id,
                "thumbnail_b64": _make_thumbnail(pid),
                "animation_summaries": [
                    {
                        "animation_id": a.animation_id,
                        "animation_type": a.llm_plan.get("animation_type"),
                    }
                    for a in proj.animations
                ],
                "updated_at": proj.updated_at,
            }
        )
    summaries.sort(key=lambda s: s.get("updated_at") or "", reverse=True)
    return {"projects": summaries}


def _make_thumbnail(project_id: str, max_dim: int = 64) -> str | None:
    src = project_store.source_path(project_id)
    if not src.exists():
        return None
    try:
        img = Image.open(src).convert("RGBA")
        img.thumbnail((max_dim, max_dim))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        import base64

        return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception:  # noqa: BLE001
        return None


@router.delete("/projects/{project_id}", status_code=204)
async def delete_project(project_id: str = Depends(validate_project_id)) -> None:
    try:
        project_store.delete_project(project_id)
    except project_store.ProjectNotFoundError:
        raise HTTPException(status_code=404, detail="project not found")
    return None


@router.post("/projects/{project_id}/duplicate")
async def duplicate_project(project_id: str = Depends(validate_project_id)) -> dict[str, str]:
    new_id = project_store.new_id_slug()
    try:
        project_store.duplicate_project(project_id, new_id)
    except project_store.ProjectNotFoundError:
        raise HTTPException(status_code=404, detail="project not found")
    return {"project_id": new_id}
