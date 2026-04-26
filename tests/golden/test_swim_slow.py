"""Golden tests for fish_swim_slow_v1.

These tests use deterministic procedural fixtures (no on-disk golden bytes)
and assert structural properties: correct frame count, correct output size,
non-static tail (oscillation present), tail-priority resolution, GIF/spritesheet
emission.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from sprite_gen.renderer import RendererArgs, RenderError, UnknownTemplateError, render
from sprite_gen.renderer.base import resolve_priority_masks


def _make_source(tmp: Path) -> Path:
    img = Image.new("RGBA", (64, 32), (0, 0, 0, 0))
    arr = np.array(img)
    # Body: opaque ellipse-ish band in the middle
    arr[10:22, 8:48, :3] = (200, 80, 80)
    arr[10:22, 8:48, 3] = 255
    # Tail: smaller block on right
    arr[12:20, 48:60, :3] = (180, 60, 60)
    arr[12:20, 48:60, 3] = 255
    Image.fromarray(arr).save(tmp / "source.png")
    return tmp / "source.png"


def _make_mask(tmp: Path, name: str, region: tuple[int, int, int, int]) -> Path:
    arr = np.zeros((32, 64), dtype=np.uint8)
    y0, y1, x0, x1 = region
    arr[y0:y1, x0:x1] = 255
    path = tmp / f"{name}.png"
    Image.fromarray(arr, mode="L").save(path)
    return path


def _args(frames: int = 8) -> RendererArgs:
    return RendererArgs(
        tail_amplitude=0.3,
        mouth_open_ratio=0.0,
        body_follow=0.1,
        fps=12,
        frames=frames,
        output_width=128,
        output_height=64,
    )


def test_unknown_template_raises(tmp_path: Path) -> None:
    src = _make_source(tmp_path)
    with pytest.raises(UnknownTemplateError):
        render(
            source_image=src,
            masks={"body": None, "tail": None, "mouth": None, "fin": None},
            template_id="fish_jump_v1",
            args=_args(),
            loop=True,
            export_format="both",
            output_dir=tmp_path / "out",
        )


def test_swim_slow_emits_gif_and_spritesheet(tmp_path: Path) -> None:
    src = _make_source(tmp_path)
    body = _make_mask(tmp_path, "body", (10, 22, 8, 48))
    tail = _make_mask(tmp_path, "tail", (12, 20, 48, 60))
    out = tmp_path / "out"
    result = render(
        source_image=src,
        masks={"body": body, "tail": tail, "mouth": None, "fin": None},
        template_id="fish_swim_slow_v1",
        args=_args(8),
        loop=True,
        export_format="both",
        output_dir=out,
    )
    assert result.gif_path is not None and result.gif_path.exists()
    assert result.spritesheet_path is not None and result.spritesheet_path.exists()

    # Spritesheet width = frames * output_width
    sheet = Image.open(result.spritesheet_path)
    assert sheet.size == (128 * 8, 64)


def test_swim_slow_only_gif(tmp_path: Path) -> None:
    src = _make_source(tmp_path)
    body = _make_mask(tmp_path, "body", (10, 22, 8, 48))
    tail = _make_mask(tmp_path, "tail", (12, 20, 48, 60))
    out = tmp_path / "out"
    result = render(
        source_image=src,
        masks={"body": body, "tail": tail, "mouth": None, "fin": None},
        template_id="fish_swim_slow_v1",
        args=_args(),
        loop=True,
        export_format="gif",
        output_dir=out,
    )
    assert result.gif_path is not None and result.gif_path.exists()
    assert result.spritesheet_path is None


def test_swim_slow_only_spritesheet(tmp_path: Path) -> None:
    src = _make_source(tmp_path)
    body = _make_mask(tmp_path, "body", (10, 22, 8, 48))
    tail = _make_mask(tmp_path, "tail", (12, 20, 48, 60))
    out = tmp_path / "out"
    result = render(
        source_image=src,
        masks={"body": body, "tail": tail, "mouth": None, "fin": None},
        template_id="fish_swim_slow_v1",
        args=_args(),
        loop=True,
        export_format="spritesheet",
        output_dir=out,
    )
    assert result.gif_path is None
    assert result.spritesheet_path is not None and result.spritesheet_path.exists()


def test_tail_oscillation_visible_across_frames(tmp_path: Path) -> None:
    """Tail region should occupy different x-positions across frames."""
    src = _make_source(tmp_path)
    body = _make_mask(tmp_path, "body", (10, 22, 8, 48))
    tail = _make_mask(tmp_path, "tail", (12, 20, 48, 60))
    out = tmp_path / "out"
    render(
        source_image=src,
        masks={"body": body, "tail": tail, "mouth": None, "fin": None},
        template_id="fish_swim_slow_v1",
        args=_args(8),
        loop=True,
        export_format="spritesheet",
        output_dir=out,
    )
    sheet = np.array(Image.open(out / "spritesheet.png"))
    cell_w = 128
    centroids: list[float] = []
    for i in range(8):
        cell = sheet[:, i * cell_w : (i + 1) * cell_w]
        # Look at the right half of each cell — that's where the tail lands
        right = cell[:, cell_w // 2 :, 3]  # alpha channel
        ys, xs = np.where(right > 0)
        if xs.size > 0:
            centroids.append(float(xs.mean()))
        else:
            centroids.append(-1.0)
    # At least some movement (range > 1 px) — proves oscillation.
    valid = [c for c in centroids if c >= 0]
    assert len(valid) >= 4, f"too few cells with tail content: {centroids}"
    assert max(valid) - min(valid) >= 1.0, f"tail did not move across frames: {centroids}"


def test_frame_count_matches_args(tmp_path: Path) -> None:
    src = _make_source(tmp_path)
    body = _make_mask(tmp_path, "body", (10, 22, 8, 48))
    tail = _make_mask(tmp_path, "tail", (12, 20, 48, 60))
    out = tmp_path / "out"
    render(
        source_image=src,
        masks={"body": body, "tail": tail, "mouth": None, "fin": None},
        template_id="fish_swim_slow_v1",
        args=_args(4),
        loop=True,
        export_format="spritesheet",
        output_dir=out,
    )
    sheet = Image.open(out / "spritesheet.png")
    assert sheet.size == (128 * 4, 64)


def test_resolve_priority_masks() -> None:
    body = np.array([[True, True, True, True]])
    tail = np.array([[False, False, True, True]])
    mouth = np.array([[True, False, True, False]])
    fin = np.array([[False, True, False, False]])
    out = resolve_priority_masks({"body": body, "tail": tail, "mouth": mouth, "fin": fin}, 1, 4)
    assert out["tail"].tolist() == [[False, False, True, True]]
    # Mouth wins where it isn't tail
    assert out["mouth"].tolist() == [[True, False, False, False]]
    # Fin wins where neither tail nor mouth
    assert out["fin"].tolist() == [[False, True, False, False]]
    # Body is residual
    assert out["body"].tolist() == [[False, False, False, False]]


def test_loop_setting_recorded_in_gif(tmp_path: Path) -> None:
    src = _make_source(tmp_path)
    body = _make_mask(tmp_path, "body", (10, 22, 8, 48))
    tail = _make_mask(tmp_path, "tail", (12, 20, 48, 60))
    out = tmp_path / "out"
    # loop=True should produce an infinite-loop GIF
    render(
        source_image=src,
        masks={"body": body, "tail": tail, "mouth": None, "fin": None},
        template_id="fish_swim_slow_v1",
        args=_args(),
        loop=True,
        export_format="gif",
        output_dir=out,
    )
    img = Image.open(out / "result.gif")
    img.seek(0)
    # PIL exposes the GIF NETSCAPE loop count if present (0 = infinite).
    loop_value = img.info.get("loop", None)
    assert loop_value == 0
