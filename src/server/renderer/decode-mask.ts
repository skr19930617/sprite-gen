import sharp from 'sharp';
import {
  REGION_LABELS,
  REGION_PALETTE,
  type RegionLabel,
} from '@/lib/mask/palette';
import type { MaskBuffer } from '@/lib/mask/correction';

export type DecodedMasks = {
  width: number;
  height: number;
  layers: Record<RegionLabel, MaskBuffer>;
};

const COLOR_TOLERANCE = 32;

const matchLabel = (
  r: number,
  g: number,
  b: number,
  a: number,
): RegionLabel | null => {
  if (a < 64) return null;
  let best: RegionLabel | null = null;
  let bestDist = COLOR_TOLERANCE * COLOR_TOLERANCE * 3;
  for (const label of REGION_LABELS) {
    const [pr, pg, pb] = REGION_PALETTE[label];
    const dr = pr - r;
    const dg = pg - g;
    const db = pb - b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = label;
    }
  }
  return best;
};

export const decodeMaskPng = async (mask: Buffer): Promise<DecodedMasks> => {
  const image = sharp(mask).ensureAlpha();
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width === 0 || height === 0) {
    throw new Error('decodeMaskPng: empty image');
  }
  const raw = await image.raw().toBuffer();
  const empty = (): MaskBuffer => ({
    width,
    height,
    data: new Uint8Array(width * height),
  });
  const layers: Record<RegionLabel, MaskBuffer> = {
    body: empty(),
    tail: empty(),
    mouth: empty(),
    fin: empty(),
  };
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const label = matchLabel(
      raw[o] ?? 0,
      raw[o + 1] ?? 0,
      raw[o + 2] ?? 0,
      raw[o + 3] ?? 0,
    );
    if (label) layers[label].data[i] = 1;
  }
  return { width, height, layers };
};
