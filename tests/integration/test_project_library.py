"""Integration tests for project library / reload semantics."""

from __future__ import annotations

import io
import json
import os
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from server.main import create_app
from sprite_gen import project_store


@pytest.fixture
def client(tmp_projects_dir: Path, mock_claude_bin: Path) -> TestClient:
    return TestClient(create_app())


def _create(client: TestClient) -> str:
    img = Image.new("RGBA", (32, 32), (200, 0, 0, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    res = client.post(
        "/projects",
        files={"source": ("fish.png", buf.getvalue(), "image/png")},
        data={"output": json.dumps({"width": 128, "height": 128, "fps": 12, "frame_count": 8, "export_format": "both"})},
    )
    return res.json()["project_id"]


def _full_animation(client: TestClient, pid: str) -> str:
    arr = np.zeros((32, 32), dtype=np.uint8)
    arr[10:20, 10:20] = 255
    buf2 = io.BytesIO()
    Image.fromarray(arr, mode="L").save(buf2, format="PNG")
    client.post(
        f"/projects/{pid}/masks/tail",
        content=buf2.getvalue(),
        headers={"Content-Type": "image/png"},
    )
    state_dir = Path(os.environ["MOCK_CLAUDE_STATE_DIR"])
    plan = {
        "entity_type": "fish",
        "animation_type": "swim_slow",
        "required_regions": ["tail"],
        "optional_regions": [],
        "params": {"speed": "slow", "amplitude": "small", "emphasis": "tail", "loop": True},
        "annotation_schema": [{"label": "tail", "required": True}],
    }
    (state_dir / "next_response.json").write_text(json.dumps(plan))
    client.post(f"/projects/{pid}/llm-plan", json={"prompt": "swim"})
    rc = {"renderer_template": "fish_swim_slow_v1", "args": {"tail_amplitude": 0.2, "mouth_open_ratio": 0, "body_follow": 0.1, "fps": 12, "frames": 8, "output_width": 128, "output_height": 128}}
    (state_dir / "next_response.json").write_text(json.dumps(rc))
    client.post(f"/projects/{pid}/renderer-config", json={})
    return client.post(f"/projects/{pid}/animations", json={}).json()["animation"]["animation_id"]


def test_list_includes_thumbnail_b64(client: TestClient) -> None:
    pid = _create(client)
    res = client.get("/projects").json()
    summary = next(p for p in res["projects"] if p["project_id"] == pid)
    assert summary["thumbnail_b64"] is not None
    assert summary["thumbnail_b64"].startswith("data:image/png;base64,")


def test_duplicate_save_creates_empty_animations(client: TestClient) -> None:
    pid = _create(client)
    aid = _full_animation(client, pid)
    res = client.post(f"/projects/{pid}/duplicate")
    assert res.status_code == 200
    new_pid = res.json()["project_id"]
    new_detail = client.get(f"/projects/{new_pid}").json()
    assert new_detail["animations"] == []
    new_dir = project_store.project_dir(new_pid)
    assert (new_dir / "source.png").exists()
    assert (new_dir / "mask" / "tail.png").exists()
    assert (new_dir / "animations").exists()
    assert not (new_dir / "animations" / aid).exists()
    assert not (new_dir / "_drafts").exists()


def test_reload_restores_animation_history(client: TestClient, tmp_projects_dir: Path) -> None:
    pid = _create(client)
    aid = _full_animation(client, pid)

    # Simulate restart by re-instantiating the app
    fresh_client = TestClient(create_app())
    detail = fresh_client.get(f"/projects/{pid}").json()
    assert any(a["animation_id"] == aid for a in detail["animations"])
    entry = next(a for a in detail["animations"] if a["animation_id"] == aid)
    assert entry["renderer_config"]["renderer_template"] == "fish_swim_slow_v1"
    assert entry["outputs_urls"]["gif_url"].endswith(f"animations/{aid}/result.gif")


def test_delete_then_list(client: TestClient) -> None:
    pid = _create(client)
    client.delete(f"/projects/{pid}")
    listing = client.get("/projects").json()
    assert all(p["project_id"] != pid for p in listing["projects"])


def test_invalid_id_in_get(client: TestClient) -> None:
    res = client.get("/projects/UPPER")
    assert res.status_code == 400


def test_invalid_id_in_delete(client: TestClient) -> None:
    res = client.delete("/projects/UPPER")
    assert res.status_code == 400


def test_invalid_id_in_duplicate(client: TestClient) -> None:
    res = client.post("/projects/UPPER/duplicate")
    assert res.status_code == 400
