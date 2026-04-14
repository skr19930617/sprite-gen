/**
 * Mask correction filter: clip-to-opacity + fill small holes + remove
 * isolated pixels. Pure functions over Uint8Array (1 byte per pixel,
 * 0 = unset, 1 = set).
 */

export type MaskBuffer = {
  width: number;
  height: number;
  /** length = width * height; 0 or 1 */
  data: Uint8Array;
};

export const cloneMask = (m: MaskBuffer): MaskBuffer => ({
  width: m.width,
  height: m.height,
  data: new Uint8Array(m.data),
});

/** Remove pixels where the source is fully transparent (alphaMap[i] === 0). */
export const clipToOpacity = (
  mask: MaskBuffer,
  alphaMap: Uint8Array,
): MaskBuffer => {
  if (alphaMap.length !== mask.data.length) {
    throw new Error('clipToOpacity: alphaMap length mismatch');
  }
  const out = cloneMask(mask);
  for (let i = 0; i < out.data.length; i++) {
    if (alphaMap[i] === 0) out.data[i] = 0;
  }
  return out;
};

const idx = (m: MaskBuffer, x: number, y: number): number => y * m.width + x;

const get = (m: MaskBuffer, x: number, y: number): number => {
  if (x < 0 || y < 0 || x >= m.width || y >= m.height) return 0;
  return m.data[idx(m, x, y)] ?? 0;
};

/**
 * Fill a single-pixel hole if all 4-neighbours are set.
 * Optionally restrict to pixels where alphaMap is opaque.
 */
export const fillSmallHoles = (
  mask: MaskBuffer,
  alphaMap?: Uint8Array,
): MaskBuffer => {
  const out = cloneMask(mask);
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      const i = idx(mask, x, y);
      if (mask.data[i] !== 0) continue;
      if (alphaMap && (alphaMap[i] ?? 0) === 0) continue;
      if (
        get(mask, x - 1, y) === 1 &&
        get(mask, x + 1, y) === 1 &&
        get(mask, x, y - 1) === 1 &&
        get(mask, x, y + 1) === 1
      ) {
        out.data[i] = 1;
      }
    }
  }
  return out;
};

/** Drop pixels with no 8-neighbour. */
export const removeIsolatedPixels = (mask: MaskBuffer): MaskBuffer => {
  const out = cloneMask(mask);
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      const i = idx(mask, x, y);
      if (mask.data[i] !== 1) continue;
      let neighbour = 0;
      for (let dy = -1; dy <= 1 && neighbour === 0; dy++) {
        for (let dx = -1; dx <= 1 && neighbour === 0; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (get(mask, x + dx, y + dy) === 1) neighbour = 1;
        }
      }
      if (neighbour === 0) out.data[i] = 0;
    }
  }
  return out;
};

/** Convenience: apply all three corrections in spec order. */
export const applyMaskCorrection = (
  mask: MaskBuffer,
  alphaMap: Uint8Array,
): MaskBuffer => {
  const clipped = clipToOpacity(mask, alphaMap);
  const filled = fillSmallHoles(clipped, alphaMap);
  return removeIsolatedPixels(filled);
};

export const countSetPixels = (mask: MaskBuffer): number => {
  let n = 0;
  for (let i = 0; i < mask.data.length; i++) if (mask.data[i] === 1) n++;
  return n;
};
