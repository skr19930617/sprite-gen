"""Read-only static asset endpoints.

Per design.md "Static-asset serving": serves source.png, mask/<label>.png,
animations/<id>/result.gif, animations/<id>/spritesheet.png. All path params
are validated against slug / label vocabularies BEFORE filesystem resolution
to prevent traversal.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from server.deps import validate_animation_id, validate_label, validate_project_id
from sprite_gen import project_store

router = APIRouter(prefix="/projects/{project_id}/static", tags=["static"])


@router.get("/source.png")
async def serve_source(project_id: str = Depends(validate_project_id)) -> FileResponse:
    if not project_store.project_exists(project_id):
        raise HTTPException(status_code=404, detail="project not found")
    path = project_store.source_path(project_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="source.png missing")
    return FileResponse(path, media_type="image/png")


@router.get("/mask/{label}.png")
async def serve_mask(
    project_id: str = Depends(validate_project_id),
    label: str = Depends(validate_label),
) -> FileResponse:
    if not project_store.project_exists(project_id):
        raise HTTPException(status_code=404, detail="project not found")
    path = project_store.mask_path(project_id, label)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"mask/{label}.png missing")
    return FileResponse(path, media_type="image/png")


@router.get("/animations/{animation_id}/result.gif")
async def serve_gif(
    project_id: str = Depends(validate_project_id),
    animation_id: str = Depends(validate_animation_id),
) -> FileResponse:
    if not project_store.project_exists(project_id):
        raise HTTPException(status_code=404, detail="project not found")
    path = project_store.gif_path(project_id, animation_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="result.gif missing")
    return FileResponse(path, media_type="image/gif")


@router.get("/animations/{animation_id}/spritesheet.png")
async def serve_spritesheet(
    project_id: str = Depends(validate_project_id),
    animation_id: str = Depends(validate_animation_id),
) -> FileResponse:
    if not project_store.project_exists(project_id):
        raise HTTPException(status_code=404, detail="project not found")
    path = project_store.spritesheet_path(project_id, animation_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="spritesheet.png missing")
    return FileResponse(path, media_type="image/png")
