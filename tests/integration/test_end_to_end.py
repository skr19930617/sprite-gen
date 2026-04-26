"""End-to-end PoC flow test.

Exercises the spec's acceptance conditions §26 entirely via the HTTP API
(plus the mock Claude CLI). Covers:
  - PNG upload (RGBA + RGB conversion)
  - prompt + output settings input
  - LLM first-pass plan
  - body auto-init, tail/mouth annotation
  - renderer-config args edit
  - render
  - second animation on the same project
  - server restart + project reload
"""

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


def _png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _mask_bytes(arr: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(arr.astype(np.uint8), mode="L").save(buf, format="PNG")
    return buf.getvalue()


def _state_dir() -> Path:
    return Path(os.environ["MOCK_CLAUDE_STATE_DIR"])


def _queue_response(payload: dict) -> None:
    (_state_dir() / "next_response.json").write_text(json.dumps(payload))


def _swim_plan() -> dict:
    return {
        "entity_type": "fish",
        "animation_type": "swim_slow",
        "required_regions": ["tail"],
        "optional_regions": ["fin"],
        "params": {"speed": "slow", "amplitude": "small", "emphasis": "tail", "loop": True},
        "annotation_schema": [{"label": "tail", "required": True}, {"label": "fin", "required": False}],
    }


def _eat_plan() -> dict:
    return {
        "entity_type": "fish",
        "animation_type": "eat",
        "required_regions": ["tail", "mouth"],
        "optional_regions": ["fin"],
        "params": {"speed": "slow", "amplitude": "small", "emphasis": "mouth", "loop": True},
        "annotation_schema": [
            {"label": "tail", "required": True},
            {"label": "mouth", "required": True},
            {"label": "fin", "required": False},
        ],
    }


def _swim_config() -> dict:
    return {
        "renderer_template": "fish_swim_slow_v1",
        "args": {
            "tail_amplitude": 0.25,
            "mouth_open_ratio": 0,
            "body_follow": 0.1,
            "fps": 12,
            "frames": 8,
            "output_width": 128,
            "output_height": 128,
        },
    }


def _eat_config() -> dict:
    return {
        "renderer_template": "fish_eat_v1",
        "args": {
            "tail_amplitude": 0.1,
            "mouth_open_ratio": 0.4,
            "body_follow": 0.0,
            "fps": 12,
            "frames": 8,
            "output_width": 128,
            "output_height": 128,
        },
    }


def test_full_poc_flow(client: TestClient, tmp_projects_dir: Path) -> None:
    # 1. Upload RGBA PNG
    img = Image.new("RGBA", (32, 32), (200, 0, 0, 255))
    create = client.post(
        "/projects",
        files={"source": ("fish.png", _png_bytes(img), "image/png")},
        data={"output": json.dumps({"width": 128, "height": 128, "fps": 12, "frame_count": 8, "export_format": "both"})},
    )
    assert create.status_code == 200
    pid = create.json()["project_id"]
    assert create.json()["color_mode_converted"] is False

    # body auto-initialized
    detail = client.get(f"/projects/{pid}").json()
    assert detail["mask_presence"]["body"] is True

    # 2. Paint tail mask
    tail = np.zeros((32, 32), dtype=np.uint8)
    tail[10:20, 8:24] = 255
    client.post(f"/projects/{pid}/masks/tail", content=_mask_bytes(tail), headers={"Content-Type": "image/png"})

    # 3. First animation: swim_slow
    _queue_response(_swim_plan())
    plan_res = client.post(f"/projects/{pid}/llm-plan", json={"prompt": "ゆっくり泳がせたい"})
    assert plan_res.status_code == 200
    assert plan_res.json()["missing_masks"] == []  # tail present

    _queue_response(_swim_config())
    cfg_res = client.post(f"/projects/{pid}/renderer-config", json={})
    assert cfg_res.status_code == 200

    # User edits args before render
    edited = dict(_swim_config()["args"])
    edited["tail_amplitude"] = 0.4
    patch_res = client.patch(f"/projects/{pid}/active-draft/renderer-config", json={"args": edited})
    assert patch_res.status_code == 200

    anim1_res = client.post(f"/projects/{pid}/animations", json={})
    assert anim1_res.status_code == 200
    anim1 = anim1_res.json()["animation"]
    assert anim1["llm_plan"]["animation_type"] == "swim_slow"
    assert anim1["annotation"]["labels_present"] == ["body", "tail"]

    # 4. Add another animation (eat) — paint mouth, then run plan
    mouth = np.zeros((32, 32), dtype=np.uint8)
    mouth[14:18, 6:14] = 255
    client.post(f"/projects/{pid}/masks/mouth", content=_mask_bytes(mouth), headers={"Content-Type": "image/png"})

    _queue_response(_eat_plan())
    plan2_res = client.post(f"/projects/{pid}/llm-plan", json={"prompt": "餌に近づいて口をぱくっと開ける"})
    assert plan2_res.status_code == 200
    assert plan2_res.json()["missing_masks"] == []

    _queue_response(_eat_config())
    client.post(f"/projects/{pid}/renderer-config", json={})
    anim2_res = client.post(f"/projects/{pid}/animations", json={})
    assert anim2_res.status_code == 200
    anim2 = anim2_res.json()["animation"]
    assert anim2["llm_plan"]["animation_type"] == "eat"

    # 5. Reload as a fresh app and verify both animations survive
    fresh = TestClient(create_app())
    detail_after = fresh.get(f"/projects/{pid}").json()
    ids = [a["animation_id"] for a in detail_after["animations"]]
    assert anim1["animation_id"] in ids
    assert anim2["animation_id"] in ids

    # Each animation entry conforms to v3 schema (no top-level mask_labels_present, has annotation.labels_present)
    for entry in detail_after["animations"]:
        assert "mask_labels_present" not in entry
        assert "annotation" in entry
        assert "labels_present" in entry["annotation"]
        assert "renderer_config_path" in entry
        assert entry["renderer_version"] == 1

    # 6. Asset URLs work
    gif_res = fresh.get(detail_after["animations"][0]["outputs_urls"]["gif_url"])
    assert gif_res.status_code == 200


def test_full_poc_flow_with_rgb_upload(client: TestClient) -> None:
    """RGB PNG → RGBA conversion path with fully-opaque body."""
    img = Image.new("RGB", (32, 32), (255, 0, 0))
    create = client.post(
        "/projects",
        files={"source": ("fish.png", _png_bytes(img), "image/png")},
        data={"output": json.dumps({"width": 128, "height": 128, "fps": 12, "frame_count": 8, "export_format": "gif"})},
    )
    assert create.status_code == 200
    assert create.json()["color_mode_converted"] is True
    pid = create.json()["project_id"]

    # body fully opaque
    body_arr = np.array(Image.open(project_store.mask_path(pid, "body")).convert("L"))
    assert np.all(body_arr == 255)
