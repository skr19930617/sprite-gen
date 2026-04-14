import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { render } from '@/server/renderer';
import { REGION_PALETTE, type RegionLabel } from '@/lib/mask/palette';

const SIZE = 512;

const buildLargeSourcePng = async (): Promise<Buffer> => {
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  // Body ellipse-ish in the centre, plus tail / mouth strips.
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (x - cx) / 180;
      const dy = (y - cy) / 80;
      if (dx * dx + dy * dy <= 1) {
        const o = (y * SIZE + x) * 4;
        rgba[o] = 240;
        rgba[o + 1] = 160;
        rgba[o + 2] = 80;
        rgba[o + 3] = 255;
      }
    }
  }
  // Tail strip (left side)
  for (let y = cy - 20; y < cy + 20; y++) {
    for (let x = cx - 220; x < cx - 160; x++) {
      const o = (y * SIZE + x) * 4;
      rgba[o] = 200;
      rgba[o + 1] = 40;
      rgba[o + 2] = 40;
      rgba[o + 3] = 255;
    }
  }
  // Mouth (right tip)
  for (let y = cy - 8; y < cy + 8; y++) {
    for (let x = cx + 150; x < cx + 180; x++) {
      const o = (y * SIZE + x) * 4;
      rgba[o] = 60;
      rgba[o + 1] = 60;
      rgba[o + 2] = 60;
      rgba[o + 3] = 255;
    }
  }
  return await sharp(rgba, { raw: { width: SIZE, height: SIZE, channels: 4 } })
    .png()
    .toBuffer();
};

const buildLargeMaskPng = async (): Promise<Buffer> => {
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  const setPx = (x: number, y: number, label: RegionLabel) => {
    const o = (y * SIZE + x) * 4;
    const [r, g, b] = REGION_PALETTE[label];
    rgba[o] = r;
    rgba[o + 1] = g;
    rgba[o + 2] = b;
    rgba[o + 3] = 255;
  };
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (x - cx) / 180;
      const dy = (y - cy) / 80;
      if (dx * dx + dy * dy <= 1) setPx(x, y, 'body');
    }
  }
  for (let y = cy - 20; y < cy + 20; y++) {
    for (let x = cx - 220; x < cx - 160; x++) setPx(x, y, 'tail');
  }
  for (let y = cy - 8; y < cy + 8; y++) {
    for (let x = cx + 150; x < cx + 180; x++) setPx(x, y, 'mouth');
  }
  return await sharp(rgba, { raw: { width: SIZE, height: SIZE, channels: 4 } })
    .png()
    .toBuffer();
};

describe('renderer benchmark', () => {
  it('512x512 + 16f swim_slow completes well under 20s', async () => {
    const source = await buildLargeSourcePng();
    const mask = await buildLargeMaskPng();
    const start = Date.now();
    const out = await render({
      source,
      mask,
      animation_type: 'swim_slow',
      params: {
        speed: 'slow',
        amplitude: 'small',
        emphasis: 'none',
        loop: true,
      },
      required_regions: ['body', 'tail'],
    });
    const elapsed = Date.now() - start;
    // Soft assertion: <20s. Log so we can track regressions in CI.
    // eslint-disable-next-line no-console
    console.warn(
      `[bench] swim_slow 512x512x16f: ${elapsed}ms (gif=${out.gif.length}B sheet=${out.spritesheet.length}B)`,
    );
    expect(out.frameCount).toBe(16);
    expect(elapsed).toBeLessThan(20_000);
  }, 60_000);
});
