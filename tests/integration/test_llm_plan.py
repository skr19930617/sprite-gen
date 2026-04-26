"""Integration tests for llm-plan-draft bundle."""

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
def client(tmp_projects_dir: Path, mock_claude_bin: Path) -> TestClient:
    return TestClient(create_app())


def _create_project(client: TestClient) -> str:
    img = Image.new("RGBA", (32, 32), (200, 0, 0, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    res = client.post(
        "/projects",
        files={"source": ("fish.png", buf.getvalue(), "image/png")},
        data={"output": json.dumps({"width": 128, "height": 128, "fps": 12, "frame_count": 8, "export_format": "both"})},
    )
    return res.json()["project_id"]


def _queue_response(payload: dict) -> None:
    state_dir = Path(__import__("os").environ["MOCK_CLAUDE_STATE_DIR"])
    (state_dir / "next_response.json").write_text(json.dumps(payload))


def _queue_failure(directive: str) -> None:
    state_dir = Path(__import__("os").environ["MOCK_CLAUDE_STATE_DIR"])
    (state_dir / "next_failure.txt").write_text(directive)


def _valid_swim_plan() -> dict:
    return {
        "entity_type": "fish",
        "animation_type": "swim_slow",
        "required_regions": ["tail"],
        "optional_regions": ["fin"],
        "params": {"speed": "slow", "amplitude": "small", "emphasis": "tail", "loop": True},
        "annotation_schema": [{"label": "tail", "required": True}],
    }


def _valid_eat_plan() -> dict:
    return {
        "entity_type": "fish",
        "animation_type": "eat",
        "required_regions": ["tail", "mouth"],
        "optional_regions": ["fin"],
        "params": {"speed": "slow", "amplitude": "small", "emphasis": "mouth", "loop": True},
        "annotation_schema": [{"label": "tail", "required": True}, {"label": "mouth", "required": True}],
    }


def test_valid_plan_persists_draft(client: TestClient) -> None:
    pid = _create_project(client)
    _queue_response(_valid_swim_plan())
    res = client.post(f"/projects/{pid}/llm-plan", json={"prompt": "swim slowly"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["resolved_plan"]["animation_type"] == "swim_slow"
    assert body["missing_masks"] == ["tail"]
    assert project_store.has_plan_draft(pid)


def test_default_filling_for_missing_params(client: TestClient) -> None:
    pid = _create_project(client)
    plan = _valid_eat_plan()
    plan["params"] = {"loop": False}  # missing speed/amplitude/emphasis
    _queue_response(plan)
    res = client.post(f"/projects/{pid}/llm-plan", json={"prompt": "eat"})
    assert res.status_code == 200
    rp = res.json()["resolved_plan"]
    assert rp["params"]["speed"] == "slow"
    assert rp["params"]["amplitude"] == "small"
    assert rp["params"]["emphasis"] == "mouth"  # default for eat
    assert rp["params"]["loop"] is False


def test_unsupported_animation_type_for_poc(client: TestClient) -> None:
    pid = _create_project(client)
    plan = _valid_swim_plan()
    plan["animation_type"] = "turn"  # spec-valid but PoC unsupported
    _queue_response(plan)
    res = client.post(f"/projects/{pid}/llm-plan", json={"prompt": "turn"})
    assert res.status_code == 422
    body = res.json()["detail"]
    assert body["error_kind"] == "unsupported_animation_type_for_poc"
    # No draft persisted on fail-fast
    assert not project_store.has_plan_draft(pid)


def test_multi_animation_rejected(client: TestClient) -> None:
    pid = _create_project(client)
    _queue_response({"animations": [_valid_swim_plan(), _valid_swim_plan()]})
    res = client.post(f"/projects/{pid}/llm-plan", json={"prompt": "swim"})
    assert res.status_code == 422
    assert res.json()["detail"]["error_kind"] == "llm_schema_mismatch"


def test_invalid_label_rejected(client: TestClient) -> None:
    pid = _create_project(client)
    plan = _valid_swim_plan()
    plan["required_regions"] = ["wing"]
    _queue_response(plan)
    res = client.post(f"/projects/{pid}/llm-plan", json={"prompt": "swim"})
    assert res.status_code == 422
    assert res.json()["detail"]["error_kind"] == "llm_schema_mismatch"


def test_llm_invalid_json(client: TestClient) -> None:
    pid = _create_project(client)
    _queue_failure("invalid_json")
    res = client.post(f"/projects/{pid}/llm-plan", json={"prompt": "swim"})
    assert res.status_code == 422
    assert res.json()["detail"]["error_kind"] == "llm_invalid_json"


def test_llm_empty_output(client: TestClient) -> None:
    pid = _create_project(client)
    _queue_failure("empty_output")
    res = client.post(f"/projects/{pid}/llm-plan", json={"prompt": "swim"})
    assert res.status_code == 422
    assert res.json()["detail"]["error_kind"] == "llm_cli_empty_output"


def test_llm_exit_nonzero(client: TestClient) -> None:
    pid = _create_project(client)
    _queue_failure("exit_nonzero")
    res = client.post(f"/projects/{pid}/llm-plan", json={"prompt": "swim"})
    assert res.status_code == 422
    assert res.json()["detail"]["error_kind"] == "llm_cli_exit_nonzero"


def test_llm_auth_required(client: TestClient) -> None:
    pid = _create_project(client)
    _queue_failure("auth_required")
    res = client.post(f"/projects/{pid}/llm-plan", json={"prompt": "swim"})
    assert res.status_code == 401
    assert res.json()["detail"]["error_kind"] == "llm_auth_required"


def test_missing_masks_uses_required_regions_only(client: TestClient) -> None:
    """optional_regions should NOT contribute to missing_masks."""
    pid = _create_project(client)
    plan = _valid_swim_plan()
    plan["required_regions"] = ["tail"]
    plan["optional_regions"] = ["fin", "mouth"]
    _queue_response(plan)
    res = client.post(f"/projects/{pid}/llm-plan", json={"prompt": "swim"})
    assert res.status_code == 200
    assert res.json()["missing_masks"] == ["tail"]


def test_patch_active_draft_params_round_trip(client: TestClient) -> None:
    pid = _create_project(client)
    _queue_response(_valid_swim_plan())
    client.post(f"/projects/{pid}/llm-plan", json={"prompt": "swim"})
    res = client.patch(
        f"/projects/{pid}/active-draft/params",
        json={"params": {"speed": "medium", "amplitude": "medium", "emphasis": "tail", "loop": False}},
    )
    assert res.status_code == 200
    assert res.json()["plan"]["params"]["loop"] is False
    draft = project_store.load_plan_draft(pid)
    assert draft.params["speed"] == "medium"
    assert draft.params["loop"] is False


def test_new_llm_plan_invalidates_renderer_draft(client: TestClient, tmp_projects_dir: Path) -> None:
    pid = _create_project(client)
    _queue_response(_valid_swim_plan())
    client.post(f"/projects/{pid}/llm-plan", json={"prompt": "swim"})

    # Manually inject a renderer draft from outside
    from sprite_gen.project_models import RendererConfigDraft
    rc = RendererConfigDraft(
        renderer_template="fish_swim_slow_v1",
        args={"tail_amplitude": 0.2, "mouth_open_ratio": 0, "body_follow": 0.1, "fps": 12, "frames": 8, "output_width": 128, "output_height": 128},
        loop=True,
        plan_token="oldtoken",
        created_at=project_store.now_iso(),
    )
    project_store.save_renderer_draft(pid, rc)
    assert project_store.has_renderer_config_draft(pid)

    # New plan should clear it
    _queue_response(_valid_swim_plan())
    client.post(f"/projects/{pid}/llm-plan", json={"prompt": "swim again"})
    assert not project_store.has_renderer_config_draft(pid)


def test_delete_active_draft_clears_both(client: TestClient) -> None:
    pid = _create_project(client)
    _queue_response(_valid_swim_plan())
    client.post(f"/projects/{pid}/llm-plan", json={"prompt": "swim"})
    res = client.delete(f"/projects/{pid}/active-draft")
    assert res.status_code == 204
    assert not project_store.has_plan_draft(pid)
    assert not project_store.has_renderer_config_draft(pid)
