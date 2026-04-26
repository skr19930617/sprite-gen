"""Comprehensive LLM failure-mode coverage across BOTH llm-plan and renderer-config.

Spec: design.md "CLI 失敗時の振る舞い" + spec llm-renderer-config "LLM CLI failure handling".

For every failure mode listed below we assert:
  (a) the HTTP response carries the expected error_kind / retriable flag,
  (b) project.json.animations[] length is unchanged,
  (c) no animations/<id>/ directory was created,
  (d) the active draft state from before the failed call is preserved
      (a failed llm-plan does NOT clobber an existing valid plan from a prior call).
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


def _create(client: TestClient) -> str:
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
    return pid


def _state_dir() -> Path:
    return Path(os.environ["MOCK_CLAUDE_STATE_DIR"])


def _queue_failure(directive: str) -> None:
    (_state_dir() / "next_failure.txt").write_text(directive)


def _queue_response(payload: dict) -> None:
    (_state_dir() / "next_response.json").write_text(json.dumps(payload))


def _good_plan() -> dict:
    return {
        "entity_type": "fish",
        "animation_type": "swim_slow",
        "required_regions": ["tail"],
        "optional_regions": [],
        "params": {"speed": "slow", "amplitude": "small", "emphasis": "tail", "loop": True},
        "annotation_schema": [{"label": "tail", "required": True}],
    }


def _good_config() -> dict:
    return {
        "renderer_template": "fish_swim_slow_v1",
        "args": {
            "tail_amplitude": 0.2,
            "mouth_open_ratio": 0,
            "body_follow": 0.1,
            "fps": 12,
            "frames": 8,
            "output_width": 128,
            "output_height": 128,
        },
    }


def _baseline_animations(client: TestClient, pid: str) -> int:
    return len(client.get(f"/projects/{pid}").json()["animations"])


def _animations_dir_count(pid: str) -> int:
    base = project_store.animations_dir(pid)
    if not base.exists():
        return 0
    return len([p for p in base.iterdir() if p.is_dir() and not p.name.startswith(".")])


# ---------------------------------------------------------------------------
# Failure modes for /llm-plan
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "directive,expected_kind,http_status",
    [
        ("exit_nonzero", "llm_cli_exit_nonzero", 422),
        ("empty_output", "llm_cli_empty_output", 422),
        ("invalid_json", "llm_invalid_json", 422),
        ("auth_required", "llm_auth_required", 401),
    ],
)
def test_llm_plan_failure_modes(client: TestClient, directive: str, expected_kind: str, http_status: int) -> None:
    pid = _create(client)
    base = _baseline_animations(client, pid)
    base_dirs = _animations_dir_count(pid)
    _queue_failure(directive)
    res = client.post(f"/projects/{pid}/llm-plan", json={"prompt": "swim"})
    assert res.status_code == http_status
    assert res.json()["detail"]["error_kind"] == expected_kind
    # Project untouched
    assert _baseline_animations(client, pid) == base
    assert _animations_dir_count(pid) == base_dirs
    assert not project_store.has_plan_draft(pid)


def test_llm_plan_failure_preserves_existing_valid_draft(client: TestClient) -> None:
    pid = _create(client)
    _queue_response(_good_plan())
    client.post(f"/projects/{pid}/llm-plan", json={"prompt": "swim"})
    assert project_store.has_plan_draft(pid)
    saved = project_store.load_plan_draft(pid).to_json()

    _queue_failure("exit_nonzero")
    fail_res = client.post(f"/projects/{pid}/llm-plan", json={"prompt": "another"})
    assert fail_res.status_code == 422

    # Existing valid draft is preserved (failed call does not corrupt it).
    after = project_store.load_plan_draft(pid).to_json()
    assert after == saved


def test_unsupported_animation_type_does_not_persist_draft(client: TestClient) -> None:
    pid = _create(client)
    plan = _good_plan()
    plan["animation_type"] = "turn"
    _queue_response(plan)
    res = client.post(f"/projects/{pid}/llm-plan", json={"prompt": "turn"})
    assert res.status_code == 422
    assert res.json()["detail"]["error_kind"] == "unsupported_animation_type_for_poc"
    assert not project_store.has_plan_draft(pid)


# ---------------------------------------------------------------------------
# Failure modes for /renderer-config
# ---------------------------------------------------------------------------


def _seed_plan(client: TestClient, pid: str) -> None:
    _queue_response(_good_plan())
    client.post(f"/projects/{pid}/llm-plan", json={"prompt": "swim"})


@pytest.mark.parametrize(
    "directive,expected_kind,http_status",
    [
        ("exit_nonzero", "llm_cli_exit_nonzero", 422),
        ("empty_output", "llm_cli_empty_output", 422),
        ("invalid_json", "llm_invalid_json", 422),
        ("auth_required", "llm_auth_required", 401),
    ],
)
def test_renderer_config_failure_modes(client: TestClient, directive: str, expected_kind: str, http_status: int) -> None:
    pid = _create(client)
    _seed_plan(client, pid)
    base = _baseline_animations(client, pid)
    base_dirs = _animations_dir_count(pid)

    _queue_failure(directive)
    res = client.post(f"/projects/{pid}/renderer-config", json={})
    assert res.status_code == http_status
    assert res.json()["detail"]["error_kind"] == expected_kind
    # Project untouched
    assert _baseline_animations(client, pid) == base
    assert _animations_dir_count(pid) == base_dirs
    # Plan draft preserved (renderer_config failure does not invalidate plan)
    assert project_store.has_plan_draft(pid)
    assert not project_store.has_renderer_config_draft(pid)


# ---------------------------------------------------------------------------
# Render-stage failures (animations endpoint)
# ---------------------------------------------------------------------------


def test_unknown_template_at_animations_via_seeded_draft(client: TestClient) -> None:
    """Inject a bogus renderer_template directly into the draft slot."""
    pid = _create(client)
    _seed_plan(client, pid)
    _queue_response(_good_config())
    client.post(f"/projects/{pid}/renderer-config", json={})

    # Manually corrupt the renderer draft to point at a nonexistent template
    rc = project_store.load_renderer_draft(pid)
    rc.renderer_template = "fish_jump_v1"
    project_store.save_renderer_draft(pid, rc)

    base = _baseline_animations(client, pid)
    res = client.post(f"/projects/{pid}/animations", json={})
    assert res.status_code == 422
    assert res.json()["detail"]["error_kind"] == "unknown_renderer_template"
    assert _baseline_animations(client, pid) == base
    # No partial animation directory created
    assert _animations_dir_count(pid) == 0
