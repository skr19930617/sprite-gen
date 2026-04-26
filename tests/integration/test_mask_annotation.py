"""Integration tests for mask-annotation-flow."""

from __future__ import annotations

import io
import json
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from server.main import create_app
from sprite_gen import project_store


@pytest.fixture
def client(tmp_projects_dir: Path) -> TestClient:
    return TestClient(create_app())


def _create_project(client: TestClient, w: int = 32, h: int = 32) -> str:
    img = Image.new("RGBA", (w, h), (200, 0, 0, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    response = client.post(
        "/projects",
        files={"source": ("fish.png", buf.getvalue(), "image/png")},
        data={
            "output": json.dumps(
                {"width": 128, "height": 128, "fps": 12, "frame_count": 8, "export_format": "both"}
            )
        },
    )
    return response.json()["project_id"]


def _png_bytes(arr: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(arr.astype(np.uint8), mode="L").save(buf, format="PNG")
    return buf.getvalue()


def test_upload_tail_mask_round_trip(client: TestClient) -> None:
    pid = _create_project(client)
    arr = np.zeros((32, 32), dtype=np.uint8)
    arr[10:20, 10:20] = 255
    response = client.post(
        f"/projects/{pid}/masks/tail",
        content=_png_bytes(arr),
        headers={"Content-Type": "image/png"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["label"] == "tail"
    assert body["mask_url"] == f"/projects/{pid}/static/mask/tail.png"
    assert body["has_content"] is True
    assert project_store.mask_path(pid, "tail").exists()


def test_upload_filters_isolated_pixel_for_tail(client: TestClient) -> None:
    pid = _create_project(client)
    arr = np.zeros((32, 32), dtype=np.uint8)
    arr[8, 8] = 255  # isolated pixel — server-side filter should drop it
    response = client.post(
        f"/projects/{pid}/masks/tail",
        content=_png_bytes(arr),
        headers={"Content-Type": "image/png"},
    )
    body = response.json()
    assert response.status_code == 200
    assert body["has_content"] is False
    persisted = np.array(Image.open(project_store.mask_path(pid, "tail")).convert("L"))
    assert np.all(persisted == 0)


def test_body_skips_filters_round_trip(client: TestClient) -> None:
    """Body should be persisted as-is even with isolated pixels (no cleanup)."""
    pid = _create_project(client)
    arr = np.zeros((32, 32), dtype=np.uint8)
    arr[5, 5] = 255  # would be killed for tail, kept for body
    response = client.post(
        f"/projects/{pid}/masks/body",
        content=_png_bytes(arr),
        headers={"Content-Type": "image/png"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["has_content"] is True
    persisted = np.array(Image.open(project_store.mask_path(pid, "body")).convert("L"))
    assert persisted[5, 5] == 255


def test_reject_size_mismatch(client: TestClient) -> None:
    pid = _create_project(client, w=32, h=32)
    arr = np.zeros((16, 16), dtype=np.uint8)
    response = client.post(
        f"/projects/{pid}/masks/tail",
        content=_png_bytes(arr),
        headers={"Content-Type": "image/png"},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["error_kind"] == "mask_size_mismatch"


def test_reject_invalid_label(client: TestClient) -> None:
    pid = _create_project(client)
    arr = np.zeros((32, 32), dtype=np.uint8)
    response = client.post(
        f"/projects/{pid}/masks/wing",
        content=_png_bytes(arr),
        headers={"Content-Type": "image/png"},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["error_kind"] == "invalid_mask_label"


def test_static_mask_serves_after_upload(client: TestClient) -> None:
    pid = _create_project(client)
    arr = np.zeros((32, 32), dtype=np.uint8)
    arr[10:20, 10:20] = 255
    client.post(
        f"/projects/{pid}/masks/tail",
        content=_png_bytes(arr),
        headers={"Content-Type": "image/png"},
    )
    response = client.get(f"/projects/{pid}/static/mask/tail.png")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"


def test_get_project_lists_uploaded_mask(client: TestClient) -> None:
    pid = _create_project(client)
    arr = np.zeros((32, 32), dtype=np.uint8)
    arr[10:20, 10:20] = 255
    client.post(
        f"/projects/{pid}/masks/tail",
        content=_png_bytes(arr),
        headers={"Content-Type": "image/png"},
    )
    detail = client.get(f"/projects/{pid}").json()
    assert "tail" in detail["masks"]
    assert detail["mask_presence"]["tail"] is True
