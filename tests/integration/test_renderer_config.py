"""Integration tests for the renderer-config endpoint."""

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


def _create_project_with_tail_mask(client: TestClient) -> str:
    img = Image.new("RGBA", (32, 32), (200, 0, 0, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    res = client.post(
        "/projects",
        files={"source": ("fish.png", buf.getvalue(), "image/png")},
        data={"output": json.dumps({"width": 128, "height": 128, "fps": 12, "frame_count": 8, "export_format": "both"})},
    )
    pid = res.json()["project_id"]

    # Provide a tail mask so the required_regions check passes
    arr = np.zeros((32, 32), dtype=np.uint8)
    arr[10:20, 10:20] = 255
    buf2 = io.BytesIO()
    Image.fromarray(arr, mode="L").save(buf2, format="PNG")
    client.post(
        f"/projects/{pid}/masks/tail",
        content=buf2.getvalue(),
        headers={"Content-Type": "image/png"},
    )
    return pid


def _queue_response(payload: dict) -> None:
    state_dir = Path(os.environ["MOCK_CLAUDE_STATE_DIR"])
    (state_dir / "next_response.json").write_text(json.dumps(payload))


def _seed_swim_plan(client: TestClient, pid: str) -> None:
    plan = {
        "entity_type": "fish",
        "animation_type": "swim_slow",
        "required_regions": ["tail"],
        "optional_regions": [],
        "params": {"speed": "slow", "amplitude": "small", "emphasis": "tail", "loop": True},
        "annotation_schema": [{"label": "tail", "required": True}],
    }
    _queue_response(plan)
    res = client.post(f"/projects/{pid}/llm-plan", json={"prompt": "swim"})
    assert res.status_code == 200, res.text


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


def test_valid_renderer_config(client: TestClient) -> None:
    pid = _create_project_with_tail_mask(client)
    _seed_swim_plan(client, pid)
    _queue_response({"renderer_template": "fish_swim_slow_v1", "args": _valid_args()})
    res = client.post(f"/projects/{pid}/renderer-config", json={})
    assert res.status_code == 200, res.text
    rc = res.json()["renderer_config"]
    assert rc["renderer_template"] == "fish_swim_slow_v1"
    assert rc["loop"] is True
    assert "plan_token" in rc
    assert project_store.has_renderer_config_draft(pid)


def test_unknown_renderer_template(client: TestClient) -> None:
    pid = _create_project_with_tail_mask(client)
    _seed_swim_plan(client, pid)
    _queue_response({"renderer_template": "fish_jump_v1", "args": _valid_args()})
    res = client.post(f"/projects/{pid}/renderer-config", json={})
    assert res.status_code == 422
    assert res.json()["detail"]["error_kind"] == "unknown_renderer_template"
    # No draft persisted on rejection
    assert not project_store.has_renderer_config_draft(pid)


def test_renderer_template_mismatch_for_plan(client: TestClient) -> None:
    pid = _create_project_with_tail_mask(client)
    _seed_swim_plan(client, pid)
    # plan was swim_slow but LLM returns the registered eat template
    _queue_response({"renderer_template": "fish_eat_v1", "args": _valid_args()})
    res = client.post(f"/projects/{pid}/renderer-config", json={})
    assert res.status_code == 422
    assert res.json()["detail"]["error_kind"] == "renderer_template_mismatch_for_plan_animation_type"


def test_args_out_of_range_rejected(client: TestClient) -> None:
    pid = _create_project_with_tail_mask(client)
    _seed_swim_plan(client, pid)
    bad = _valid_args()
    bad["tail_amplitude"] = 1.5
    _queue_response({"renderer_template": "fish_swim_slow_v1", "args": bad})
    res = client.post(f"/projects/{pid}/renderer-config", json={})
    assert res.status_code == 422
    assert res.json()["detail"]["error_kind"] == "args_out_of_range"


def test_fps_mismatch_overridden_with_log(client: TestClient, caplog) -> None:
    pid = _create_project_with_tail_mask(client)
    _seed_swim_plan(client, pid)
    bad = _valid_args()
    bad["fps"] = 24  # project stored fps=12
    _queue_response({"renderer_template": "fish_swim_slow_v1", "args": bad})

    import logging
    with caplog.at_level(logging.WARNING, logger="sprite_gen.routers.renderer_config"):
        res = client.post(f"/projects/{pid}/renderer-config", json={})
    assert res.status_code == 200
    rc = res.json()["renderer_config"]
    assert rc["args"]["fps"] == 12
    # Look for the structured warning log
    matched = [r for r in caplog.records if r.message == "renderer_config_arg_overridden"]
    assert matched, "expected renderer_config_arg_overridden warning log"
    record = matched[0]
    assert getattr(record, "field", None) == "fps"
    assert getattr(record, "llm_value", None) == 24
    assert getattr(record, "enforced_value", None) == 12


def test_required_masks_missing(client: TestClient) -> None:
    img = Image.new("RGBA", (32, 32), (200, 0, 0, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    res = client.post(
        "/projects",
        files={"source": ("fish.png", buf.getvalue(), "image/png")},
        data={"output": json.dumps({"width": 128, "height": 128, "fps": 12, "frame_count": 8, "export_format": "both"})},
    )
    pid = res.json()["project_id"]
    # Skip tail mask intentionally
    plan = {
        "entity_type": "fish",
        "animation_type": "swim_slow",
        "required_regions": ["tail"],
        "optional_regions": [],
        "params": {"speed": "slow", "amplitude": "small", "emphasis": "tail", "loop": True},
        "annotation_schema": [{"label": "tail", "required": True}],
    }
    _queue_response(plan)
    client.post(f"/projects/{pid}/llm-plan", json={"prompt": "swim"})

    res = client.post(f"/projects/{pid}/renderer-config", json={})
    assert res.status_code == 422
    assert res.json()["detail"]["error_kind"] == "required_masks_missing"


def test_no_active_plan_draft(client: TestClient) -> None:
    pid = _create_project_with_tail_mask(client)
    res = client.post(f"/projects/{pid}/renderer-config", json={})
    assert res.status_code == 404
    assert res.json()["detail"]["error_kind"] == "no_active_plan_draft"


def test_loop_propagates_from_params(client: TestClient) -> None:
    pid = _create_project_with_tail_mask(client)
    _seed_swim_plan(client, pid)
    # Patch params to set loop=False
    client.patch(
        f"/projects/{pid}/active-draft/params",
        json={"params": {"speed": "slow", "amplitude": "small", "emphasis": "tail", "loop": False}},
    )
    _queue_response({"renderer_template": "fish_swim_slow_v1", "args": _valid_args()})
    res = client.post(f"/projects/{pid}/renderer-config", json={})
    assert res.status_code == 200
    assert res.json()["renderer_config"]["loop"] is False


def test_patch_renderer_config_rejects_loop(client: TestClient) -> None:
    pid = _create_project_with_tail_mask(client)
    _seed_swim_plan(client, pid)
    _queue_response({"renderer_template": "fish_swim_slow_v1", "args": _valid_args()})
    client.post(f"/projects/{pid}/renderer-config", json={})

    res = client.patch(
        f"/projects/{pid}/active-draft/renderer-config",
        json={"loop": False},
    )
    assert res.status_code == 400
    assert res.json()["detail"]["error_kind"] == "forbidden_keys_in_renderer_config_patch"


def test_patch_renderer_config_args_round_trip(client: TestClient) -> None:
    pid = _create_project_with_tail_mask(client)
    _seed_swim_plan(client, pid)
    _queue_response({"renderer_template": "fish_swim_slow_v1", "args": _valid_args()})
    client.post(f"/projects/{pid}/renderer-config", json={})

    res = client.patch(
        f"/projects/{pid}/active-draft/renderer-config",
        json={"args": {"tail_amplitude": 0.4, "mouth_open_ratio": 0, "body_follow": 0.05, "fps": 12, "frames": 8, "output_width": 128, "output_height": 128}},
    )
    assert res.status_code == 200, res.text
    assert res.json()["renderer_config"]["args"]["tail_amplitude"] == 0.4
