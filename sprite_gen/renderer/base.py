"""Base template + render entrypoint + GIF/spritesheet export helpers."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Literal

import imageio.v2 as imageio
import numpy as np
from PIL import Image

from sprite_gen.config import LABELS

ExportFormat = Literal["gif", "spritesheet", "both"]
Label = Literal["body", "tail", "mouth", "fin"]
LABEL_PRIORITY: tuple[str, ...] = ("tail", "mouth", "fin", "body")


@dataclass
class RendererArgs:
    tail_amplitude: float
    mouth_open_ratio: float
    body_follow: float
    fps: int
    frames: int
    output_width: int
    output_height: int

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "RendererArgs":
        return cls(
            tail_amplitude=float(data["tail_amplitude"]),
            mouth_open_ratio=float(data["mouth_open_ratio"]),
            body_follow=float(data["body_follow"]),
            fps=int(data["fps"]),
            frames=int(data["frames"]),
            output_width=int(data["output_width"]),
            output_height=int(data["output_height"]),
        )

    def to_json(self) -> dict[str, Any]:
        return {
            "tail_amplitude": self.tail_amplitude,
            "mouth_open_ratio": self.mouth_open_ratio,
            "body_follow": self.body_follow,
            "fps": self.fps,
            "frames": self.frames,
            "output_width": self.output_width,
            "output_height": self.output_height,
        }


@dataclass
class RenderOutputs:
    gif_path: Path | None
    spritesheet_path: Path | None


class RenderError(Exception):
    """Generic render failure — server maps to 500."""


class UnknownTemplateError(Exception):
    """Raised by render() when template_id is not in the registry."""


# ---------------------------------------------------------------------------
# Mask priority resolution
# ---------------------------------------------------------------------------


def _ensure_label_arr(masks: dict[str, np.ndarray], label: str, h: int, w: int) -> np.ndarray:
    arr = masks.get(label)
    if arr is None:
        return np.zeros((h, w), dtype=bool)
    return arr.astype(bool)


def resolve_priority_masks(masks: dict[str, np.ndarray], h: int, w: int) -> dict[str, np.ndarray]:
    """Apply ``tail > mouth > fin > body`` priority.

    Returns a new dict where each pixel is assigned to exactly one label.
    Pixels not in any mask are not in any returned mask.
    """
    body = _ensure_label_arr(masks, "body", h, w)
    tail = _ensure_label_arr(masks, "tail", h, w)
    mouth = _ensure_label_arr(masks, "mouth", h, w)
    fin = _ensure_label_arr(masks, "fin", h, w)

    # Tail wins everywhere it's set
    final_tail = tail.copy()
    # Mouth: only where not tail
    final_mouth = mouth & ~final_tail
    # Fin: only where neither tail nor mouth
    final_fin = fin & ~final_tail & ~final_mouth
    # Body: residual
    final_body = body & ~final_tail & ~final_mouth & ~final_fin
    return {
        "tail": final_tail,
        "mouth": final_mouth,
        "fin": final_fin,
        "body": final_body,
    }


# ---------------------------------------------------------------------------
# Base template
# ---------------------------------------------------------------------------


class BaseTemplate:
    """Subclass and implement ``render_frames``.

    Returned frames are RGBA numpy arrays of shape
    ``(output_height, output_width, 4)``, dtype uint8.
    """

    template_id: str = ""

    def render_frames(
        self,
        source_rgba: np.ndarray,
        masks: dict[str, np.ndarray],
        args: RendererArgs,
    ) -> list[np.ndarray]:
        raise NotImplementedError


# ---------------------------------------------------------------------------
# Export helpers
# ---------------------------------------------------------------------------


def write_gif(frames: list[np.ndarray], dest: Path, fps: int, loop: bool) -> None:
    """Write an animated GIF.

    Imageio's ``loop`` is the GIF "Loop Count" extension: 0 = infinite, 1 =
    play once, etc. Spec: ``loop=true`` → infinite (0); ``loop=false`` → 1.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    duration = 1.0 / max(fps, 1)
    loop_value = 0 if loop else 1
    pil_frames = [Image.fromarray(f, mode="RGBA") for f in frames]
    pil_frames[0].save(
        dest,
        format="GIF",
        save_all=True,
        append_images=pil_frames[1:],
        duration=int(duration * 1000),
        loop=loop_value,
        disposal=2,
    )


def write_spritesheet(frames: list[np.ndarray], dest: Path, cell_w: int, cell_h: int) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    sheet = np.zeros((cell_h, cell_w * len(frames), 4), dtype=np.uint8)
    for idx, frame in enumerate(frames):
        sheet[:, idx * cell_w : (idx + 1) * cell_w] = frame
    Image.fromarray(sheet, mode="RGBA").save(dest, format="PNG")


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def _read_mask_as_bool(path: Path | None) -> np.ndarray | None:
    if path is None or not path.exists():
        return None
    img = Image.open(path).convert("L")
    arr = np.array(img)
    return arr >= 128


def render(
    *,
    source_image: Path,
    masks: dict[str, Path],
    template_id: str,
    args: RendererArgs,
    loop: bool,
    export_format: ExportFormat,
    output_dir: Path,
) -> RenderOutputs:
    """Render an animation; return paths of emitted assets.

    The renderer NEVER constructs the final ``animations/<id>/`` directory —
    that's the caller's atomic-rename responsibility. ``output_dir`` should
    be a same-filesystem staging directory; the caller renames it into place.
    """
    from sprite_gen.renderer.registry import REGISTERED_TEMPLATES

    template_cls = REGISTERED_TEMPLATES.get(template_id)
    if template_cls is None:
        raise UnknownTemplateError(template_id)

    template: BaseTemplate = template_cls()

    src_img = Image.open(source_image).convert("RGBA")
    src_arr = np.array(src_img)
    h, w = src_arr.shape[:2]

    masks_arr: dict[str, np.ndarray] = {}
    for label in LABELS:
        masks_arr[label] = _read_mask_as_bool(masks.get(label)) if masks.get(label) is not None else np.zeros((h, w), dtype=bool)

    frames = template.render_frames(src_arr, masks_arr, args)
    if not frames:
        raise RenderError("template returned zero frames")
    if len(frames) != args.frames:
        raise RenderError(f"template returned {len(frames)} frames but args.frames={args.frames}")

    output_dir.mkdir(parents=True, exist_ok=True)
    gif_path: Path | None = None
    sheet_path: Path | None = None
    if export_format in ("gif", "both"):
        gif_path = output_dir / "result.gif"
        write_gif(frames, gif_path, args.fps, loop)
    if export_format in ("spritesheet", "both"):
        sheet_path = output_dir / "spritesheet.png"
        write_spritesheet(frames, sheet_path, args.output_width, args.output_height)

    return RenderOutputs(gif_path=gif_path, spritesheet_path=sheet_path)
