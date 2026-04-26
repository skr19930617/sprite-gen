"""Shared pytest fixtures for sprite-gen tests.

Each test gets a temporary projects directory pointed at by the env var
``SPRITE_GEN_PROJECTS_ROOT``. The store helpers honor this to keep tests
isolated from any developer-local ``projects/`` folder.
"""

from __future__ import annotations

import io
import os
import shutil
from pathlib import Path
from typing import Iterator

import pytest
from PIL import Image

FIXTURE_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture
def tmp_projects_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Provide an isolated projects directory and patch config to use it."""
    projects = tmp_path / "projects"
    projects.mkdir()
    monkeypatch.setenv("SPRITE_GEN_PROJECTS_ROOT", str(projects))

    # Re-import config in dependent modules — the project_store module reads
    # the env var on every call so no reload is needed.
    yield projects

    # tmp_path cleans up automatically.


@pytest.fixture
def fixture_dir() -> Path:
    return FIXTURE_DIR


@pytest.fixture
def fish_rgba_png(fixture_dir: Path) -> bytes:
    """Small RGBA fish-shaped fixture image (binary PNG bytes)."""
    return (fixture_dir / "fish_rgba_64x32.png").read_bytes()


@pytest.fixture
def fish_rgb_png(fixture_dir: Path) -> bytes:
    return (fixture_dir / "fish_rgb_64x32.png").read_bytes()


@pytest.fixture
def fish_gray_png(fixture_dir: Path) -> bytes:
    return (fixture_dir / "fish_gray_64x32.png").read_bytes()


@pytest.fixture
def oversize_png() -> bytes:
    """Generate an in-memory PNG larger than 2048x2048 for size-rejection tests."""
    img = Image.new("RGBA", (3000, 100), (0, 0, 0, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def mock_claude_bin(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Install the mock Claude CLI on a temporary PATH and return its path.

    Tests can write a JSON response to ``<mock>/next_response.json`` and the
    mock will emit it on the next invocation. See tests/fixtures/mock_claude.py
    for the response protocol.
    """
    src = FIXTURE_DIR / "mock_claude.py"
    dst_dir = tmp_path / "bin"
    dst_dir.mkdir()
    dst = dst_dir / "claude"
    shutil.copy(src, dst)
    dst.chmod(0o755)

    state_dir = tmp_path / "claude_state"
    state_dir.mkdir()

    monkeypatch.setenv("SPRITE_GEN_CLAUDE_BIN", str(dst))
    monkeypatch.setenv("MOCK_CLAUDE_STATE_DIR", str(state_dir))
    return dst


def _ensure_fixtures() -> None:
    """Lazily generate fixture PNGs if the package was installed without them."""
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)

    rgba_path = FIXTURE_DIR / "fish_rgba_64x32.png"
    if not rgba_path.exists():
        img = _make_fish_rgba(64, 32)
        img.save(rgba_path)

    rgb_path = FIXTURE_DIR / "fish_rgb_64x32.png"
    if not rgb_path.exists():
        img = _make_fish_rgba(64, 32).convert("RGB")
        img.save(rgb_path)

    gray_path = FIXTURE_DIR / "fish_gray_64x32.png"
    if not gray_path.exists():
        img = _make_fish_rgba(64, 32).convert("L")
        img.save(gray_path)


def _make_fish_rgba(w: int, h: int) -> Image.Image:
    """Procedural mini-fish: filled ellipse body + triangular tail.

    Used as a deterministic fixture for tests; not artistic.
    """
    from PIL import ImageDraw

    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # Body: ellipse
    draw.ellipse([w // 8, h // 4, (w * 3) // 4, (h * 3) // 4], fill=(200, 80, 80, 255))
    # Tail: triangle on right
    draw.polygon(
        [(w * 3 // 4, h // 2), (w - 2, h // 4), (w - 2, h * 3 // 4)],
        fill=(180, 60, 60, 255),
    )
    return img


_ensure_fixtures()
