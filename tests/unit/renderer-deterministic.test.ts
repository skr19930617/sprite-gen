import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { render } from '@/server/renderer';
import {
  REGION_PALETTE,
  REGION_LABELS,
  type RegionLabel,
} from '@/lib/mask/palette';

const SIZE = 32;

const buildSourcePng = async (): Promise<Buffer> => {
  // 32x32 fish-shaped sprite: white body rectangle 8..24 x 12..20,
  // blue tail rect 0..8 x 14..18, red mouth rect 24..28 x 14..18.
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const o = (y * SIZE + x) * 4;
      if (x >= 8 && x < 24 && y >= 12 && y < 20) {
        // body — orange
        rgba[o] = 240;
        rgba[o + 1] = 160;
        rgba[o + 2] = 80;
        rgba[o + 3] = 255;
      } else if (x < 8 && y >= 14 && y < 18) {
        rgba[o] = 200;
        rgba[o + 1] = 40;
        rgba[o + 2] = 40;
        rgba[o + 3] = 255;
      } else if (x >= 24 && x < 28 && y >= 14 && y < 18) {
        rgba[o] = 60;
        rgba[o + 1] = 60;
        rgba[o + 2] = 60;
        rgba[o + 3] = 255;
      }
    }
  }
  return sharp(rgba, { raw: { width: SIZE, height: SIZE, channels: 4 } })
    .png()
    .toBuffer();
};

const buildMaskPng = async (
  options: { withTail?: boolean } = {},
): Promise<Buffer> => {
  const { withTail = true } = options;
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  const setPixel = (x: number, y: number, label: RegionLabel) => {
    const o = (y * SIZE + x) * 4;
    const [r, g, b] = REGION_PALETTE[label];
    rgba[o] = r;
    rgba[o + 1] = g;
    rgba[o + 2] = b;
    rgba[o + 3] = 255;
  };
  // body region
  for (let y = 12; y < 20; y++) {
    for (let x = 8; x < 24; x++) setPixel(x, y, 'body');
  }
  if (withTail) {
    for (let y = 14; y < 18; y++) {
      for (let x = 0; x < 8; x++) setPixel(x, y, 'tail');
    }
  }
  // mouth
  for (let y = 14; y < 18; y++) {
    for (let x = 24; x < 28; x++) setPixel(x, y, 'mouth');
  }
  void REGION_LABELS;
  return sharp(rgba, { raw: { width: SIZE, height: SIZE, channels: 4 } })
    .png()
    .toBuffer();
};

const sha256 = (buf: Buffer): string =>
  createHash('sha256').update(buf).digest('hex');

describe('renderer determinism', () => {
  it('produces identical GIF + spritesheet bytes for identical inputs', async () => {
    const source = await buildSourcePng();
    const mask = await buildMaskPng();
    const input = {
      source,
      mask,
      animation_type: 'swim_slow' as const,
      params: {
        speed: 'slow' as const,
        amplitude: 'small' as const,
        emphasis: 'none' as const,
        loop: true,
      },
      required_regions: ['body', 'tail'] as const,
    };
    const a = await render(input);
    const b = await render(input);
    expect(sha256(a.gif)).toBe(sha256(b.gif));
    expect(sha256(a.spritesheet)).toBe(sha256(b.spritesheet));
    expect(a.frameCount).toBe(16);
    expect(a.rendererVersion).toBe(1);
    expect(a.fellBackToBodyOnly).toBe(false);
  }, 30_000);

  it('falls back to body-only when a required region has zero pixels', async () => {
    const source = await buildSourcePng();
    const mask = await buildMaskPng({ withTail: false });
    const out = await render({
      source,
      mask,
      animation_type: 'swim_slow',
      params: {
        speed: 'slow',
        amplitude: 'small',
        emphasis: 'none',
        loop: false,
      },
      required_regions: ['body', 'tail'],
    });
    expect(out.fellBackToBodyOnly).toBe(true);
    expect(out.frameCount).toBe(16);
  }, 30_000);
});
