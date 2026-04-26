"""Integration tests for the image-input-intake bundle.

Spec: openspec/specs/image-input-intake/spec.md
"""

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
    app = create_app()
    return TestClient(app)


def _good_output() -> dict:
    return {
        "width": 128,
        "height": 128,
        "fps": 12,
        "frame_count": 8,
        "export_format": "both",
    }


def _png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_accept_valid_rgba_png(client: TestClient) -> None:
    img = Image.new("RGBA", (256, 128), (200, 0, 0, 255))
    response = client.post(
        "/projects",
        files={"source": ("fish.png", _png_bytes(img), "image/png")},
        data={"output": json.dumps(_good_output())},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert "project_id" in body
    assert body["source_dim"] == {"w": 256, "h": 128}
    assert body["color_mode_converted"] is False

    pid = body["project_id"]
    assert project_store.source_path(pid).exists()
    body_mask = project_store.mask_path(pid, "body")
    assert body_mask.exists()
    arr = np.array(Image.open(body_mask).convert("L"))
    # Source is fully opaque → body should be all-white
    assert np.all(arr == 255)


def test_accept_rgb_png_converts_to_rgba_and_full_body(client: TestClient) -> None:
    img = Image.new("RGB", (32, 32), (255, 0, 0))
    response = client.post(
        "/projects",
        files={"source": ("fish.png", _png_bytes(img), "image/png")},
        data={"output": json.dumps(_good_output())},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["color_mode_converted"] is True
    pid = body["project_id"]
    src_img = Image.open(project_store.source_path(pid))
    assert src_img.mode == "RGBA"
    # Fully opaque body
    body_arr = np.array(Image.open(project_store.mask_path(pid, "body")).convert("L"))
    assert np.all(body_arr == 255)


def test_accept_grayscale_png_converts(client: TestClient) -> None:
    img = Image.new("L", (32, 32), 128)
    response = client.post(
        "/projects",
        files={"source": ("fish.png", _png_bytes(img), "image/png")},
        data={"output": json.dumps(_good_output())},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["color_mode_converted"] is True


def test_reject_oversized_dimensions(client: TestClient) -> None:
    img = Image.new("RGBA", (4096, 100), (0, 0, 0, 255))
    response = client.post(
        "/projects",
        files={"source": ("big.png", _png_bytes(img), "image/png")},
        data={"output": json.dumps(_good_output())},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["error_kind"] == "image_too_large"


def test_reject_non_png(client: TestClient) -> None:
    img = Image.new("RGB", (32, 32), (255, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    response = client.post(
        "/projects",
        files={"source": ("fish.jpg", buf.getvalue(), "image/jpeg")},
        data={"output": json.dumps(_good_output())},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["error_kind"] in {"non_png", "invalid_png"}


def test_reject_invalid_fps_range(client: TestClient) -> None:
    img = Image.new("RGBA", (32, 32), (200, 0, 0, 255))
    bad = _good_output()
    bad["fps"] = 0
    response = client.post(
        "/projects",
        files={"source": ("fish.png", _png_bytes(img), "image/png")},
        data={"output": json.dumps(bad)},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["error_kind"] == "invalid_fps"


def test_reject_invalid_frame_count(client: TestClient) -> None:
    img = Image.new("RGBA", (32, 32), (200, 0, 0, 255))
    bad = _good_output()
    bad["frame_count"] = 1
    response = client.post(
        "/projects",
        files={"source": ("fish.png", _png_bytes(img), "image/png")},
        data={"output": json.dumps(bad)},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["error_kind"] == "invalid_frame_count"


def test_reject_missing_export_format(client: TestClient) -> None:
    img = Image.new("RGBA", (32, 32), (200, 0, 0, 255))
    bad = _good_output()
    del bad["export_format"]
    response = client.post(
        "/projects",
        files={"source": ("fish.png", _png_bytes(img), "image/png")},
        data={"output": json.dumps(bad)},
    )
    assert response.status_code == 400


def test_get_project_returns_v3_shape(client: TestClient) -> None:
    img = Image.new("RGBA", (32, 32), (200, 0, 0, 255))
    response = client.post(
        "/projects",
        files={"source": ("fish.png", _png_bytes(img), "image/png")},
        data={"output": json.dumps(_good_output())},
    )
    assert response.status_code == 200
    pid = response.json()["project_id"]

    detail = client.get(f"/projects/{pid}").json()
    assert set(detail.keys()) >= {
        "project_id",
        "schema_version",
        "entity_type",
        "source_url",
        "masks",
        "mask_dir",
        "output",
        "animations",
        "mask_presence",
        "active_draft",
        "created_at",
        "updated_at",
    }
    assert detail["schema_version"] == "v3"
    assert detail["entity_type"] == "fish"
    assert detail["source_url"] == f"/projects/{pid}/static/source.png"
    assert detail["masks"]["body"] == f"/projects/{pid}/static/mask/body.png"
    assert detail["mask_presence"]["body"] is True
    assert detail["mask_presence"]["tail"] is False
    assert detail["animations"] == []


def test_static_source_serves_png(client: TestClient) -> None:
    img = Image.new("RGBA", (32, 32), (200, 0, 0, 255))
    response = client.post(
        "/projects",
        files={"source": ("fish.png", _png_bytes(img), "image/png")},
        data={"output": json.dumps(_good_output())},
    )
    pid = response.json()["project_id"]
    asset = client.get(f"/projects/{pid}/static/source.png")
    assert asset.status_code == 200
    assert asset.headers["content-type"] == "image/png"


def test_invalid_project_id_rejected(client: TestClient) -> None:
    # Path traversal attempt
    response = client.get("/projects/..%2Fescape")
    assert response.status_code in {400, 404}
    response = client.get("/projects/UPPER")
    assert response.status_code == 400


def test_static_mask_404_when_missing(client: TestClient) -> None:
    img = Image.new("RGBA", (32, 32), (200, 0, 0, 255))
    create = client.post(
        "/projects",
        files={"source": ("fish.png", _png_bytes(img), "image/png")},
        data={"output": json.dumps(_good_output())},
    )
    pid = create.json()["project_id"]
    response = client.get(f"/projects/{pid}/static/mask/tail.png")
    assert response.status_code == 404


def test_delete_project_removes_directory(client: TestClient, tmp_projects_dir: Path) -> None:
    img = Image.new("RGBA", (32, 32), (200, 0, 0, 255))
    create = client.post(
        "/projects",
        files={"source": ("fish.png", _png_bytes(img), "image/png")},
        data={"output": json.dumps(_good_output())},
    )
    pid = create.json()["project_id"]
    assert project_store.project_exists(pid)
    response = client.delete(f"/projects/{pid}")
    assert response.status_code == 204
    assert not project_store.project_exists(pid)


def test_duplicate_project_creates_new_id_with_empty_animations(client: TestClient) -> None:
    img = Image.new("RGBA", (32, 32), (200, 0, 0, 255))
    create = client.post(
        "/projects",
        files={"source": ("fish.png", _png_bytes(img), "image/png")},
        data={"output": json.dumps(_good_output())},
    )
    pid = create.json()["project_id"]
    response = client.post(f"/projects/{pid}/duplicate")
    assert response.status_code == 200
    new_pid = response.json()["project_id"]
    assert new_pid != pid
    detail = client.get(f"/projects/{new_pid}").json()
    assert detail["animations"] == []


def test_list_projects_returns_summaries(client: TestClient) -> None:
    img = Image.new("RGBA", (32, 32), (200, 0, 0, 255))
    create = client.post(
        "/projects",
        files={"source": ("fish.png", _png_bytes(img), "image/png")},
        data={"output": json.dumps(_good_output())},
    )
    pid = create.json()["project_id"]
    listing = client.get("/projects").json()
    assert any(p["project_id"] == pid for p in listing["projects"])
