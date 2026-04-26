"""fish_eat_v1 template — mouth opens/closes peak at midpoint, low-amp tail.

Spec: openspec/specs/template-renderer/spec.md Scenario "eat template animates
mouth opening and tail micro-motion".

Implementation:
  - mouth_open(i) = mouth_open_ratio * sin(π * i / (frames-1))     (peak at midpoint)
  - tail_dx(i)    = tail_amp_px * sin(2π * i / frames)             (low-amp oscillation)
  - body / fin shifts subtly with body_follow.

Mouth opening is rendered by shifting the upper half of the mouth-masked
pixels up by ``mouth_dy_px`` and the lower half down by the same amount.
"""

from __future__ import annotations

import math

import numpy as np
from PIL import Image

from sprite_gen.renderer.base import BaseTemplate, RendererArgs, resolve_priority_masks
from sprite_gen.renderer.templates.swim_slow import _shift_array


class EatTemplate(BaseTemplate):
    template_id = "fish_eat_v1"

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

        # Mouth bbox so we know how much to split it
        mouth_mask = priority["mouth"]
        if mouth_mask.any():
            ys, xs = np.where(mouth_mask)
            m_y0, m_y1 = int(ys.min()), int(ys.max()) + 1
            mouth_height = m_y1 - m_y0
        else:
            m_y0 = m_y1 = 0
            mouth_height = 0

        max_open_px = max(1, int(round(args.mouth_open_ratio * max(mouth_height, 1))))
        tail_amp_px = max(1, int(round(args.tail_amplitude * w * 0.05)))
        body_follow_px = max(0, int(round(args.body_follow * tail_amp_px)))

        frames: list[np.ndarray] = []
        for i in range(args.frames):
            # Tail: gentle 1-cycle oscillation
            tail_phase = 2.0 * math.pi * i / args.frames
            tail_dx = int(round(tail_amp_px * math.sin(tail_phase)))
            body_dx = int(round(body_follow_px * math.sin(tail_phase)))

            # Mouth open: half-cycle, peaks at midpoint
            mouth_phase = math.pi * i / max(args.frames - 1, 1)
            mouth_open_px = int(round(max_open_px * math.sin(mouth_phase)))

            canvas = np.zeros_like(source_rgba)
            self._paste(canvas, _shift_array(body_arr, body_dx))
            self._paste(canvas, fin_arr)
            self._paste(canvas, _shift_array(tail_arr, tail_dx))

            if mouth_height > 0 and mouth_open_px > 0:
                upper, lower = self._split_mouth(mouth_arr, m_y0, m_y1)
                self._paste(canvas, _shift_array(upper, 0, -mouth_open_px))
                self._paste(canvas, _shift_array(lower, 0, mouth_open_px))
            else:
                self._paste(canvas, mouth_arr)

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
        mask = layer[:, :, 3] > 0
        canvas[mask] = layer[mask]

    @staticmethod
    def _split_mouth(mouth_arr: np.ndarray, y0: int, y1: int) -> tuple[np.ndarray, np.ndarray]:
        mid = (y0 + y1) // 2
        upper = np.zeros_like(mouth_arr)
        lower = np.zeros_like(mouth_arr)
        upper[y0:mid] = mouth_arr[y0:mid]
        lower[mid:y1] = mouth_arr[mid:y1]
        return upper, lower
