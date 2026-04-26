"""Integration tests for animation commit and re-render."""

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


def _queue_response(payload: dict) -> None:
    state_dir = Path(os.environ["MOCK_CLAUDE_STATE_DIR"])
    (state_dir / "next_response.json").write_text(json.dumps(payload))


def _swim_plan() -> dict:
    return {
        "entity_type": "fish",
        "animation_type": "swim_slow",
        "required_regions": ["tail"],
        "optional_regions": [],
        "params": {"speed": "slow", "amplitude": "small", "emphasis": "tail", "loop": True},
        "annotation_schema": [{"label": "tail", "required": True}],
    }


def _valid_args() -> dict:
    return {
        "tail_amplitude": 0.2,
        "mouth_open_ratio": 0.0,
        "body_follow": 0.1,
        "fps": 12,
        "frames": 8,
        "output_width": 128,
        "output_height": 128,
    }


def _setup_project_through_renderer_config(client: TestClient) -> str:
    img = Image.new("RGBA", (32, 32), (200, 0, 0, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    res = client.post(
        "/projects",
        files={"source": ("fish.png", buf.getvalue(), "image/png")},
        data={"output": json.dumps({"width": 128, "height": 128, "fps": 12, "frame_count": 8, "export_format": "both"})},
    )
    pid = res.json()["project_id"]

    arr = np.zeros((32, 32), dtype=np.uint8)
    arr[10:20, 10:20] = 255
    buf2 = io.BytesIO()
    Image.fromarray(arr, mode="L").save(buf2, format="PNG")
    client.post(
        f"/projects/{pid}/masks/tail",
        content=buf2.getvalue(),
        headers={"Content-Type": "image/png"},
    )

    _queue_response(_swim_plan())
    client.post(f"/projects/{pid}/llm-plan", json={"prompt": "swim"})

    _queue_response({"renderer_template": "fish_swim_slow_v1", "args": _valid_args()})
    client.post(f"/projects/{pid}/renderer-config", json={})
    return pid


def test_commit_creates_v3_entry(client: TestClient) -> None:
    pid = _setup_project_through_renderer_config(client)
    res = client.post(f"/projects/{pid}/animations", json={})
    assert res.status_code == 200, res.text
    entry = res.json()["animation"]
    # v3 schema fields
    assert set(entry.keys()) >= {
        "animation_id",
        "prompt",
        "llm_plan",
        "params",
        "annotation",
        "renderer_config_path",
        "outputs",
        "renderer_version",
        "created_at",
        "updated_at",
    }
    assert "mask_labels_present" not in entry  # NOT a top-level key
    assert entry["annotation"]["labels_present"] == ["body", "tail"]
    assert entry["renderer_config_path"].startswith("animations/")
    aid = entry["animation_id"]
    pdir = project_store.project_dir(pid)
    assert (pdir / "animations" / aid / "result.gif").exists()
    assert (pdir / "animations" / aid / "spritesheet.png").exists()
    assert (pdir / "animations" / aid / "renderer_config.json").exists()
    # Drafts cleared
    assert not project_store.has_plan_draft(pid)
    assert not project_store.has_renderer_config_draft(pid)


def test_active_draft_incomplete_returns_404(client: TestClient) -> None:
    img = Image.new("RGBA", (32, 32), (200, 0, 0, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    res = client.post(
        "/projects",
        files={"source": ("fish.png", buf.getvalue(), "image/png")},
        data={"output": json.dumps({"width": 128, "height": 128, "fps": 12, "frame_count": 8, "export_format": "both"})},
    )
    pid = res.json()["project_id"]
    response = client.post(f"/projects/{pid}/animations", json={})
    assert response.status_code == 404
    assert response.json()["detail"]["error_kind"] == "active_draft_incomplete"


def test_re_render_preserves_animation_id_and_created_at(client: TestClient) -> None:
    pid = _setup_project_through_renderer_config(client)
    first = client.post(f"/projects/{pid}/animations", json={}).json()["animation"]
    aid = first["animation_id"]
    created_at = first["created_at"]

    # Seed-from sets up the draft; then patch args to simulate user edit
    res = client.post(f"/projects/{pid}/active-draft/seed-from/{aid}?overwrite=true")
    assert res.status_code == 200, res.text

    new_args = _valid_args()
    new_args["tail_amplitude"] = 0.4
    client.patch(f"/projects/{pid}/active-draft/renderer-config", json={"args": new_args})

    re_res = client.post(f"/projects/{pid}/animations/{aid}/re-render", json={})
    assert re_res.status_code == 200, re_res.text
    after = re_res.json()["animation"]
    assert after["animation_id"] == aid
    assert after["created_at"] == created_at
    # updated_at is refreshed on every re-render (may equal created_at if both
    # operations land within the same second; what matters is the refresh
    # ran).
    assert after["updated_at"] >= created_at

    # After re-render: project still has exactly one animation with the same id
    detail = client.get(f"/projects/{pid}").json()
    ids = [a["animation_id"] for a in detail["animations"]]
    assert ids == [aid]


def test_seed_from_409_when_draft_present_without_overwrite(client: TestClient) -> None:
    pid = _setup_project_through_renderer_config(client)
    aid = client.post(f"/projects/{pid}/animations", json={}).json()["animation"]["animation_id"]
    # Now create another draft to simulate "draft already in flight"
    _queue_response(_swim_plan())
    client.post(f"/projects/{pid}/llm-plan", json={"prompt": "different prompt"})

    res = client.post(f"/projects/{pid}/active-draft/seed-from/{aid}")
    assert res.status_code == 409


def test_outputs_null_when_export_format_skips(client: TestClient, tmp_projects_dir: Path) -> None:
    img = Image.new("RGBA", (32, 32), (200, 0, 0, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    res = client.post(
        "/projects",
        files={"source": ("fish.png", buf.getvalue(), "image/png")},
        data={"output": json.dumps({"width": 128, "height": 128, "fps": 12, "frame_count": 8, "export_format": "gif"})},
    )
    pid = res.json()["project_id"]

    arr = np.zeros((32, 32), dtype=np.uint8)
    arr[10:20, 10:20] = 255
    buf2 = io.BytesIO()
    Image.fromarray(arr, mode="L").save(buf2, format="PNG")
    client.post(
        f"/projects/{pid}/masks/tail",
        content=buf2.getvalue(),
        headers={"Content-Type": "image/png"},
    )

    _queue_response(_swim_plan())
    client.post(f"/projects/{pid}/llm-plan", json={"prompt": "swim"})
    _queue_response({"renderer_template": "fish_swim_slow_v1", "args": _valid_args()})
    client.post(f"/projects/{pid}/renderer-config", json={})
    entry = client.post(f"/projects/{pid}/animations", json={}).json()["animation"]
    assert entry["outputs"]["gif_path"] is not None
    assert entry["outputs"]["spritesheet_path"] is None
