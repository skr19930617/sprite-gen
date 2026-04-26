"""Golden tests for fish_eat_v1: mouth opens/closes + tail micro-motion."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from sprite_gen.renderer import RendererArgs, render


def _make_source(tmp: Path) -> Path:
    arr = np.zeros((32, 64, 4), dtype=np.uint8)
    arr[10:22, 8:48, :3] = (200, 80, 80)
    arr[10:22, 8:48, 3] = 255
    arr[12:20, 48:60, :3] = (180, 60, 60)
    arr[12:20, 48:60, 3] = 255
    # Mouth on the left side
    arr[14:18, 8:14, :3] = (255, 200, 200)
    arr[14:18, 8:14, 3] = 255
    Image.fromarray(arr, mode="RGBA").save(tmp / "source.png")
    return tmp / "source.png"


def _make_mask(tmp: Path, name: str, region: tuple[int, int, int, int]) -> Path:
    arr = np.zeros((32, 64), dtype=np.uint8)
    y0, y1, x0, x1 = region
    arr[y0:y1, x0:x1] = 255
    path = tmp / f"{name}.png"
    Image.fromarray(arr, mode="L").save(path)
    return path


def _args(frames: int = 9) -> RendererArgs:
    return RendererArgs(
        tail_amplitude=0.1,
        mouth_open_ratio=0.5,
        body_follow=0.0,
        fps=12,
        frames=frames,
        output_width=128,
        output_height=64,
    )


@pytest.fixture
def fixtures(tmp_path: Path) -> dict:
    return {
        "src": _make_source(tmp_path),
        "body": _make_mask(tmp_path, "body", (10, 22, 8, 48)),
        "tail": _make_mask(tmp_path, "tail", (12, 20, 48, 60)),
        "mouth": _make_mask(tmp_path, "mouth", (14, 18, 8, 14)),
        "out": tmp_path / "out",
    }


def test_eat_frames_emit(fixtures: dict) -> None:
    res = render(
        source_image=fixtures["src"],
        masks={"body": fixtures["body"], "tail": fixtures["tail"], "mouth": fixtures["mouth"], "fin": None},
        template_id="fish_eat_v1",
        args=_args(),
        loop=True,
        export_format="both",
        output_dir=fixtures["out"],
    )
    assert res.gif_path is not None and res.gif_path.exists()
    assert res.spritesheet_path is not None and res.spritesheet_path.exists()


def test_eat_mouth_opens_at_midpoint(fixtures: dict) -> None:
    """Mouth occupies more vertical space at the middle frame than at frame 0."""
    args = _args(9)
    render(
        source_image=fixtures["src"],
        masks={"body": fixtures["body"], "tail": fixtures["tail"], "mouth": fixtures["mouth"], "fin": None},
        template_id="fish_eat_v1",
        args=args,
        loop=True,
        export_format="spritesheet",
        output_dir=fixtures["out"],
    )
    sheet = np.array(Image.open(fixtures["out"] / "spritesheet.png"))
    cell_w = args.output_width

    def _mouth_height_at(idx: int) -> int:
        cell = sheet[:, idx * cell_w : (idx + 1) * cell_w]
        # Mouth lives on the left edge (rough region in cell coordinates).
        # Look for pixels that are pinkish (very light red component)
        r = cell[:, :, 0]
        g = cell[:, :, 1]
        b = cell[:, :, 2]
        a = cell[:, :, 3]
        mouth_mask = (r > 220) & (g > 150) & (b > 150) & (a > 0)
        if not mouth_mask.any():
            return 0
        ys = np.where(mouth_mask)[0]
        return int(ys.max() - ys.min())

    h_start = _mouth_height_at(0)
    h_mid = _mouth_height_at(args.frames // 2)
    h_end = _mouth_height_at(args.frames - 1)
    # Spec: mouth opens at midpoint, returns to closed at start/end.
    assert h_mid > h_start, f"mouth not opening: start={h_start}, mid={h_mid}"
    assert h_mid > h_end, f"mouth not closing: mid={h_mid}, end={h_end}"


def test_eat_tail_micro_motion(fixtures: dict) -> None:
    args = _args(8)
    render(
        source_image=fixtures["src"],
        masks={"body": fixtures["body"], "tail": fixtures["tail"], "mouth": fixtures["mouth"], "fin": None},
        template_id="fish_eat_v1",
        args=args,
        loop=True,
        export_format="spritesheet",
        output_dir=fixtures["out"],
    )
    sheet = np.array(Image.open(fixtures["out"] / "spritesheet.png"))
    cell_w = args.output_width

    centroids: list[float] = []
    for i in range(args.frames):
        cell = sheet[:, i * cell_w : (i + 1) * cell_w]
        right = cell[:, cell_w // 2 :, 3]
        ys, xs = np.where(right > 0)
        if xs.size > 0:
            centroids.append(float(xs.mean()))
        else:
            centroids.append(-1.0)
    valid = [c for c in centroids if c >= 0]
    assert len(valid) >= 4
    assert max(valid) - min(valid) >= 1.0, f"tail did not show micro-motion: {centroids}"


def test_eat_loop_false_records_loop_1(fixtures: dict) -> None:
    render(
        source_image=fixtures["src"],
        masks={"body": fixtures["body"], "tail": fixtures["tail"], "mouth": fixtures["mouth"], "fin": None},
        template_id="fish_eat_v1",
        args=_args(),
        loop=False,
        export_format="gif",
        output_dir=fixtures["out"],
    )
    img = Image.open(fixtures["out"] / "result.gif")
    img.seek(0)
    loop_value = img.info.get("loop", None)
    # PIL omits the loop key entirely when set to 1 (single play); 0 = infinite.
    # Either: missing or 1.
    assert loop_value in (None, 1), f"loop should be 1 or absent for loop=False, got {loop_value!r}"
