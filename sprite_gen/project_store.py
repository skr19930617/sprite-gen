"""Project store — filesystem layout, project.json v3 I/O, draft slot helpers.

Bundle 3 (project-store-core). All filesystem mutations route through this
module so atomic-rename and v3 schema invariants are enforced in one place.
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from PIL import Image

from sprite_gen import config
from sprite_gen.project_models import (
    AnimationEntry,
    PlanDraft,
    ProjectJson,
    ProjectOutput,
    RendererConfigDraft,
    is_valid_label,
    is_valid_slug,
)

logger = logging.getLogger("sprite_gen.project_store")


# ---------------------------------------------------------------------------
# Time helpers
# ---------------------------------------------------------------------------


def now_iso() -> str:
    """Single ISO-8601 UTC timestamp source so tests can monkeypatch easily."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def new_id_slug(prefix: str = "") -> str:
    """Return a fresh URL-safe slug for project_id / animation_id."""
    raw = uuid.uuid4().hex[:10]
    return f"{prefix}{raw}" if prefix else raw


def new_plan_token() -> str:
    return uuid.uuid4().hex


# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------


def projects_root() -> Path:
    """Resolve the projects root directory.

    Honors ``SPRITE_GEN_PROJECTS_ROOT`` (set by tests) and falls back to
    ``config.PROJECTS_DIR`` for production.
    """
    env = os.environ.get("SPRITE_GEN_PROJECTS_ROOT")
    if env:
        return Path(env)
    return config.PROJECTS_DIR


def project_dir(project_id: str) -> Path:
    if not is_valid_slug(project_id):
        raise InvalidIdError(f"invalid project_id slug: {project_id!r}")
    return projects_root() / project_id


def project_json_path(project_id: str) -> Path:
    return project_dir(project_id) / "project.json"


def source_path(project_id: str) -> Path:
    return project_dir(project_id) / "source.png"


def mask_path(project_id: str, label: str) -> Path:
    if not is_valid_label(label):
        raise InvalidIdError(f"invalid mask label: {label!r}")
    return project_dir(project_id) / "mask" / f"{label}.png"


def animations_dir(project_id: str) -> Path:
    return project_dir(project_id) / "animations"


def animation_dir(project_id: str, animation_id: str) -> Path:
    if not is_valid_slug(animation_id):
        raise InvalidIdError(f"invalid animation_id slug: {animation_id!r}")
    return animations_dir(project_id) / animation_id


def animation_staging_dir(project_id: str, animation_id: str) -> Path:
    if not is_valid_slug(animation_id):
        raise InvalidIdError(f"invalid animation_id slug: {animation_id!r}")
    return animations_dir(project_id) / ".tmp" / animation_id


def animation_backup_dir(project_id: str, animation_id: str) -> Path:
    if not is_valid_slug(animation_id):
        raise InvalidIdError(f"invalid animation_id slug: {animation_id!r}")
    return animations_dir(project_id) / ".tmp" / f"{animation_id}.bak"


def renderer_config_path(project_id: str, animation_id: str) -> Path:
    return animation_dir(project_id, animation_id) / "renderer_config.json"


def gif_path(project_id: str, animation_id: str) -> Path:
    return animation_dir(project_id, animation_id) / "result.gif"


def spritesheet_path(project_id: str, animation_id: str) -> Path:
    return animation_dir(project_id, animation_id) / "spritesheet.png"


def drafts_dir(project_id: str) -> Path:
    return project_dir(project_id) / "_drafts" / "active"


def plan_draft_path(project_id: str) -> Path:
    return drafts_dir(project_id) / "plan.json"


def renderer_draft_path(project_id: str) -> Path:
    return drafts_dir(project_id) / "renderer_config.json"


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class StoreError(Exception):
    """Base error for project store failures."""


class ProjectNotFoundError(StoreError):
    pass


class InvalidIdError(StoreError):
    pass


class DraftNotFoundError(StoreError):
    pass


# ---------------------------------------------------------------------------
# Atomic file write helper
# ---------------------------------------------------------------------------


def write_json_atomic(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Project lifecycle
# ---------------------------------------------------------------------------


def create_project(project_id: str, output: ProjectOutput) -> ProjectJson:
    if not is_valid_slug(project_id):
        raise InvalidIdError(f"invalid project_id slug: {project_id!r}")

    pdir = project_dir(project_id)
    if pdir.exists():
        raise StoreError(f"project already exists: {project_id}")

    pdir.mkdir(parents=True)
    (pdir / "mask").mkdir()
    (pdir / "animations").mkdir()

    ts = now_iso()
    proj = ProjectJson(
        project_id=project_id,
        output=output,
        animations=[],
        created_at=ts,
        updated_at=ts,
    )
    write_json_atomic(project_json_path(project_id), proj.to_json())
    return proj


def project_exists(project_id: str) -> bool:
    if not is_valid_slug(project_id):
        return False
    return project_json_path(project_id).exists()


def load_project(project_id: str) -> ProjectJson:
    path = project_json_path(project_id)
    if not path.exists():
        raise ProjectNotFoundError(f"project not found: {project_id}")
    return ProjectJson.from_json(read_json(path))


def save_project(project: ProjectJson) -> None:
    project.updated_at = now_iso()
    write_json_atomic(project_json_path(project.project_id), project.to_json())


def list_project_ids() -> list[str]:
    root = projects_root()
    if not root.exists():
        return []
    out: list[str] = []
    for entry in sorted(root.iterdir()):
        if entry.is_dir() and is_valid_slug(entry.name) and project_json_path(entry.name).exists():
            out.append(entry.name)
    return out


def delete_project(project_id: str) -> None:
    pdir = project_dir(project_id)
    if not pdir.exists():
        raise ProjectNotFoundError(project_id)
    shutil.rmtree(pdir)


def duplicate_project(source_id: str, new_id: str) -> ProjectJson:
    """Copy source.png + mask/*.png into a new project with empty animations[].

    Per spec project-store: the new project MUST contain an empty animations/
    directory (preserves the layout contract) but no animation children, and
    MUST NOT copy _drafts/active/.
    """
    if not project_exists(source_id):
        raise ProjectNotFoundError(source_id)
    src = project_dir(source_id)
    dst = project_dir(new_id)
    if dst.exists():
        raise StoreError(f"project already exists: {new_id}")

    dst.mkdir(parents=True)
    shutil.copy(src / "source.png", dst / "source.png")
    (dst / "mask").mkdir()
    if (src / "mask").exists():
        for mask_file in (src / "mask").iterdir():
            if mask_file.is_file() and mask_file.suffix == ".png":
                shutil.copy(mask_file, dst / "mask" / mask_file.name)
    (dst / "animations").mkdir()

    src_proj = load_project(source_id)
    ts = now_iso()
    new_proj = ProjectJson(
        project_id=new_id,
        output=src_proj.output,
        animations=[],
        created_at=ts,
        updated_at=ts,
    )
    write_json_atomic(project_json_path(new_id), new_proj.to_json())
    return new_proj


# ---------------------------------------------------------------------------
# Mask presence (content-based)
# ---------------------------------------------------------------------------


def _apply_aux_filters_for_label(
    arr: np.ndarray, label: str, source_alpha_mask: np.ndarray | None
) -> np.ndarray:
    """Apply per-label cleanup filters.

    body — no filters (spec-mandated).
    tail/mouth/fin — clip-to-source, hole-fill, isolated-pixel-removal.

    The simple PoC implementation thresholds at 128 (binarize), then applies
    morphological-style cleanup using numpy.
    """
    if label == "body":
        return arr

    binary = (arr >= 128).astype(np.uint8)

    # 1. clip-to-source
    if source_alpha_mask is not None:
        binary = binary & source_alpha_mask.astype(np.uint8)

    # 2. hole-fill: any 0-pixel surrounded by 1-pixels in 4-neighborhood gets filled.
    #    This is intentionally a single-pass approximation suited to PoC scale.
    h, w = binary.shape
    if h >= 3 and w >= 3:
        center = binary[1:-1, 1:-1]
        up = binary[:-2, 1:-1]
        down = binary[2:, 1:-1]
        left = binary[1:-1, :-2]
        right = binary[1:-1, 2:]
        neighbor_count = up + down + left + right
        # Fill cells where neighbor_count >= 3 (3 or 4 neighbors set)
        fill_mask = (center == 0) & (neighbor_count >= 3)
        # Apply
        new_center = center.copy()
        new_center[fill_mask] = 1
        binary[1:-1, 1:-1] = new_center

    # 3. isolated-pixel-removal: 1-pixels with zero neighbors get cleared.
    if h >= 3 and w >= 3:
        center = binary[1:-1, 1:-1]
        up = binary[:-2, 1:-1]
        down = binary[2:, 1:-1]
        left = binary[1:-1, :-2]
        right = binary[1:-1, 2:]
        neighbor_count = up + down + left + right
        rem_mask = (center == 1) & (neighbor_count == 0)
        new_center = center.copy()
        new_center[rem_mask] = 0
        binary[1:-1, 1:-1] = new_center

    return (binary * 255).astype(np.uint8)


def _load_source_alpha_mask(project_id: str) -> np.ndarray | None:
    """Return a 2D uint8 array where pixels of the source with alpha>=128 are 1."""
    src = source_path(project_id)
    if not src.exists():
        return None
    img = Image.open(src).convert("RGBA")
    arr = np.array(img)
    return (arr[:, :, 3] >= config.BODY_ALPHA_THRESHOLD).astype(np.uint8)


def apply_filters_to_mask_bytes(
    project_id: str, label: str, mask_arr: np.ndarray
) -> np.ndarray:
    """Apply per-label filters and return the cleaned 2D uint8 array.

    Used by the masks router AND the presence helper so persisted bytes match
    presence judgments.
    """
    src_alpha = _load_source_alpha_mask(project_id) if label != "body" else None
    return _apply_aux_filters_for_label(mask_arr, label, src_alpha)


def mask_has_content(project_id: str, label: str) -> bool:
    """Content-based presence check.

    Returns True iff the persisted ``mask/<label>.png`` exists AND, after the
    per-label filter pipeline, contains at least one non-zero pixel.
    """
    if not is_valid_label(label):
        return False
    path = mask_path(project_id, label)
    if not path.exists():
        return False
    img = Image.open(path).convert("L")
    arr = np.array(img)
    cleaned = apply_filters_to_mask_bytes(project_id, label, arr)
    return bool(np.any(cleaned > 0))


def labels_present(project_id: str) -> list[str]:
    return [lbl for lbl in config.LABELS if mask_has_content(project_id, lbl)]


def write_mask_bytes(project_id: str, label: str, raw_mask: np.ndarray) -> tuple[Path, bool]:
    """Apply filters and persist the mask. Returns (path, has_content)."""
    cleaned = apply_filters_to_mask_bytes(project_id, label, raw_mask)
    path = mask_path(project_id, label)
    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.fromarray(cleaned, mode="L")
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", dir=str(path.parent), suffix=".png")
    os.close(fd)
    try:
        img.save(tmp, format="PNG")
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise
    has_content = bool(np.any(cleaned > 0))
    return path, has_content


# ---------------------------------------------------------------------------
# Draft slot helpers
# ---------------------------------------------------------------------------


def has_plan_draft(project_id: str) -> bool:
    return plan_draft_path(project_id).exists()


def has_renderer_config_draft(project_id: str) -> bool:
    return renderer_draft_path(project_id).exists()


def load_plan_draft(project_id: str) -> PlanDraft:
    path = plan_draft_path(project_id)
    if not path.exists():
        raise DraftNotFoundError("plan draft missing")
    return PlanDraft.from_json(read_json(path))


def save_plan_draft(project_id: str, draft: PlanDraft) -> None:
    drafts_dir(project_id).mkdir(parents=True, exist_ok=True)
    write_json_atomic(plan_draft_path(project_id), draft.to_json())


def delete_plan_draft(project_id: str) -> None:
    p = plan_draft_path(project_id)
    if p.exists():
        p.unlink()


def load_renderer_draft(project_id: str) -> RendererConfigDraft:
    path = renderer_draft_path(project_id)
    if not path.exists():
        raise DraftNotFoundError("renderer config draft missing")
    return RendererConfigDraft.from_json(read_json(path))


def save_renderer_draft(project_id: str, draft: RendererConfigDraft) -> None:
    drafts_dir(project_id).mkdir(parents=True, exist_ok=True)
    write_json_atomic(renderer_draft_path(project_id), draft.to_json())


def delete_renderer_draft(project_id: str) -> None:
    p = renderer_draft_path(project_id)
    if p.exists():
        p.unlink()


def clear_active_draft(project_id: str) -> None:
    delete_plan_draft(project_id)
    delete_renderer_draft(project_id)
    d = drafts_dir(project_id)
    if d.exists() and not any(d.iterdir()):
        d.rmdir()


# ---------------------------------------------------------------------------
# Startup recovery (called from server.main lifespan)
# ---------------------------------------------------------------------------


def startup_recovery(projects_dir: Path) -> None:
    """Scan all projects for orphan staging or backup directories.

    Recovery strategy for ``animations/.tmp/<id>.bak/``:
      - If ``animations/<id>/`` does NOT exist: rename the backup back to
        ``animations/<id>/`` (the swap was interrupted before the new content
        landed).
      - If ``animations/<id>/`` exists: the swap finished but the backup
        cleanup didn't run. Remove the backup.

    Pure ``animations/.tmp/<id>/`` (without ``.bak``) is a stale staging dir
    from a render that never committed. Remove it.
    """
    if not projects_dir.exists():
        return
    for project_dir_entry in projects_dir.iterdir():
        if not project_dir_entry.is_dir():
            continue
        tmp = project_dir_entry / "animations" / ".tmp"
        if not tmp.exists():
            continue
        for entry in tmp.iterdir():
            if entry.is_dir():
                if entry.name.endswith(".bak"):
                    real_id = entry.name[:-4]
                    real_dir = project_dir_entry / "animations" / real_id
                    if not real_dir.exists():
                        try:
                            entry.rename(real_dir)
                            logger.warning(
                                "startup_recovery: restored backup %s -> %s",
                                entry,
                                real_dir,
                            )
                        except OSError as exc:
                            logger.error("startup_recovery: failed to restore %s: %s", entry, exc)
                    else:
                        try:
                            shutil.rmtree(entry)
                            logger.info("startup_recovery: removed orphan backup %s", entry)
                        except OSError as exc:
                            logger.error("startup_recovery: failed to remove %s: %s", entry, exc)
                else:
                    # Stale staging directory from a render that never finished.
                    try:
                        shutil.rmtree(entry)
                        logger.info("startup_recovery: removed stale staging %s", entry)
                    except OSError as exc:
                        logger.error("startup_recovery: failed to remove %s: %s", entry, exc)
