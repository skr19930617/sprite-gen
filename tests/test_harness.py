"""Smoke tests confirming the test harness, fixtures, and mock CLI all work."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

from PIL import Image


def test_fixture_pngs_exist(fish_rgba_png: bytes, fish_rgb_png: bytes, fish_gray_png: bytes) -> None:
    assert len(fish_rgba_png) > 0
    assert len(fish_rgb_png) > 0
    assert len(fish_gray_png) > 0


def test_fixture_rgba_dims_and_mode(fixture_dir: Path) -> None:
    img = Image.open(fixture_dir / "fish_rgba_64x32.png")
    assert img.mode == "RGBA"
    assert img.size == (64, 32)


def test_tmp_projects_dir_isolated(tmp_projects_dir: Path) -> None:
    assert tmp_projects_dir.exists()
    assert tmp_projects_dir.is_dir()
    assert os.environ["SPRITE_GEN_PROJECTS_ROOT"] == str(tmp_projects_dir)


def test_mock_claude_emits_queued_json(mock_claude_bin: Path) -> None:
    state_dir = Path(os.environ["MOCK_CLAUDE_STATE_DIR"])
    payload = {"hello": "world"}
    (state_dir / "next_response.json").write_text(json.dumps(payload))

    result = subprocess.run(
        [str(mock_claude_bin)],
        input=json.dumps({"prompt": "test"}),
        capture_output=True,
        text=True,
        timeout=5,
    )
    assert result.returncode == 0
    assert json.loads(result.stdout) == payload

    # And it captures stdin for assertions
    stdin_capture = json.loads((state_dir / "last_stdin.json").read_text())
    assert stdin_capture == {"prompt": "test"}


def test_mock_claude_failure_exit_nonzero(mock_claude_bin: Path) -> None:
    state_dir = Path(os.environ["MOCK_CLAUDE_STATE_DIR"])
    (state_dir / "next_failure.txt").write_text("exit_nonzero\n")
    result = subprocess.run([str(mock_claude_bin)], capture_output=True, text=True, timeout=5)
    assert result.returncode == 1


def test_mock_claude_failure_invalid_json(mock_claude_bin: Path) -> None:
    state_dir = Path(os.environ["MOCK_CLAUDE_STATE_DIR"])
    (state_dir / "next_failure.txt").write_text("invalid_json\n")
    result = subprocess.run([str(mock_claude_bin)], capture_output=True, text=True, timeout=5)
    assert result.returncode == 0
    assert "not really json" in result.stdout
