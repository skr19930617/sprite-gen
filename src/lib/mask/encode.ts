import {
  REGION_LABELS,
  REGION_PALETTE,
  TRANSPARENT_PIXEL,
  type RegionLabel,
} from './palette';
import type { MaskBuffer } from './correction';

export type RegionMaskMap = Record<RegionLabel, MaskBuffer>;

/**
 * Encode the 4 region masks into a flat RGBA pixel array. Last writer wins
 * (label order = body, tail, mouth, fin) so a pixel set in `tail` overrides
 * the body color. Unset pixels are fully transparent.
 */
export const encodeMaskRgba = (
  width: number,
  height: number,
  masks: RegionMaskMap,
): Uint8ClampedArray => {
  const out = new Uint8ClampedArray(width * height * 4);
  for (const label of REGION_LABELS) {
    const mask = masks[label];
    if (mask.width !== width || mask.height !== height) {
      throw new Error(`encodeMaskRgba: ${label} mask size mismatch`);
    }
    const [r, g, b] = REGION_PALETTE[label];
    for (let i = 0; i < mask.data.length; i++) {
      if (mask.data[i] === 1) {
        const o = i * 4;
        out[o] = r;
        out[o + 1] = g;
        out[o + 2] = b;
        out[o + 3] = 0xff;
      }
    }
  }
  // Make explicitly-transparent pixels match the documented RGB (0,0,0/alpha=0).
  void TRANSPARENT_PIXEL;
  return out;
};
