"""fish_swim_slow_v1 template — periodic tail wag, body micro-follow, fin assist.

Implementation strategy (deterministic, no randomness):
1. Take the source RGBA at full source resolution.
2. For each frame ``i ∈ [0, frames)``:
     phase = 2π * i / frames
     tail_dx_px = round(amplitude_px * sin(phase))    # horizontal tail displacement
     body_dx_px = round(body_follow * tail_dx_px)
     fin flutter is implemented as a smaller, phase-shifted oscillation.
   Build a frame canvas at source size by:
     - copying body pixels (priority-resolved) with body_dx_px shift
     - copying tail pixels with tail_dx_px shift
     - copying fin pixels with fin_dx_px shift
   Pixels missing from any mask remain transparent (alpha=0).
3. Resize each frame to (output_width, output_height) using NEAREST so sprite
   pixels stay sharp.

Spec reference: openspec/specs/template-renderer/spec.md (Scenario "swim_slow
template renders an animated tail").
"""

from __future__ import annotations

import math

import numpy as np
from PIL import Image

from sprite_gen.renderer.base import (
    BaseTemplate,
    RendererArgs,
    resolve_priority_masks,
)


def _shift_array(arr: np.ndarray, dx: int, dy: int = 0) -> np.ndarray:
    h, w = arr.shape[:2]
    out = np.zeros_like(arr)
    if dx == 0 and dy == 0:
        out[...] = arr
        return out
    src_x_lo = max(0, -dx)
    src_x_hi = min(w, w - dx)
    dst_x_lo = max(0, dx)
    dst_x_hi = dst_x_lo + (src_x_hi - src_x_lo)
    src_y_lo = max(0, -dy)
    src_y_hi = min(h, h - dy)
    dst_y_lo = max(0, dy)
    dst_y_hi = dst_y_lo + (src_y_hi - src_y_lo)
    if src_x_hi <= src_x_lo or src_y_hi <= src_y_lo:
        return out
    out[dst_y_lo:dst_y_hi, dst_x_lo:dst_x_hi] = arr[src_y_lo:src_y_hi, src_x_lo:src_x_hi]
    return out


class SwimSlowTemplate(BaseTemplate):
    template_id = "fish_swim_slow_v1"

    def render_frames(
        self,
        source_rgba: np.ndarray,
        masks: dict[str, np.ndarray],
        args: RendererArgs,
    ) -> list[np.ndarray]:
        h, w = source_rgba.shape[:2]
        priority = resolve_priority_masks(masks, h, w)

        body_arr = self._extract_layer(source_rgba, priority["body"])
        tail_arr = self._extract_layer(source_rgba, priority["tail"])
        mouth_arr = self._extract_layer(source_rgba, priority["mouth"])
        fin_arr = self._extract_layer(source_rgba, priority["fin"])

        # Speed → cycles per loop; PoC uses a single cycle.
        amplitude_px = max(1, int(round(args.tail_amplitude * w * 0.15)))
        body_follow_px_max = max(0, int(round(args.body_follow * amplitude_px)))
        fin_amp_px = max(0, amplitude_px // 2)

        frames: list[np.ndarray] = []
        for i in range(args.frames):
            phase = 2.0 * math.pi * i / args.frames
            tail_dx = int(round(amplitude_px * math.sin(phase)))
            body_dx = int(round(body_follow_px_max * math.sin(phase)))
            fin_dx = int(round(fin_amp_px * math.sin(phase + math.pi / 2)))

            canvas = np.zeros_like(source_rgba)
            # Compose layers with priority order; tail/mouth/fin painted last.
            self._paste(canvas, _shift_array(body_arr, body_dx))
            self._paste(canvas, _shift_array(fin_arr, fin_dx))
            self._paste(canvas, mouth_arr)  # mouth doesn't move in swim_slow
            self._paste(canvas, _shift_array(tail_arr, tail_dx))

            # Resize to output dimensions
            img = Image.fromarray(canvas, mode="RGBA").resize(
                (args.output_width, args.output_height), resample=Image.NEAREST
            )
            frames.append(np.array(img))
        return frames

    @staticmethod
    def _extract_layer(rgba: np.ndarray, mask: np.ndarray) -> np.ndarray:
        out = np.zeros_like(rgba)
        out[mask] = rgba[mask]
        return out

    @staticmethod
    def _paste(canvas: np.ndarray, layer: np.ndarray) -> None:
        """Alpha-aware paste: layer pixels with alpha>0 overwrite canvas."""
        mask = layer[:, :, 3] > 0
        canvas[mask] = layer[mask]
