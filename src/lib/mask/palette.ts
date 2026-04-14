/**
 * Mask palette: the 4 fixed region labels with their RGB triplets.
 * Palette PNG encoding (mask.png) writes these RGB values directly so the
 * renderer can decode without an external sidecar.
 */

export const REGION_LABELS = ['body', 'tail', 'mouth', 'fin'] as const;
export type RegionLabel = (typeof REGION_LABELS)[number];

export type Rgb = readonly [r: number, g: number, b: number];

export const REGION_PALETTE: Record<RegionLabel, Rgb> = {
  body: [0xff, 0xff, 0xff],
  tail: [0x00, 0x00, 0xff],
  mouth: [0xff, 0x00, 0x00],
  fin: [0x00, 0xff, 0x00],
};

export const TRANSPARENT_PIXEL: Rgb = [0x00, 0x00, 0x00]; // alpha=0 in encoded PNG

export const labelIndex = (label: RegionLabel): number =>
  REGION_LABELS.indexOf(label);

export const labelFromIndex = (i: number): RegionLabel | null =>
  REGION_LABELS[i] ?? null;
