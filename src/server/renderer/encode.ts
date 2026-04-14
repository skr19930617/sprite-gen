import sharp from 'sharp';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { FRAME_DURATION_MS } from './types';

/**
 * Encode an array of RGBA frames into an animated GIF using gifenc.
 * loopCount: 0 = infinite, 1 = play once.
 */
export const encodeGif = (
  frames: Buffer[],
  width: number,
  height: number,
  loopCount: 0 | 1,
): Buffer => {
  const enc = GIFEncoder();
  for (const frame of frames) {
    // gifenc strictly requires a Uint8Array (Buffer subclass mismatches its type guard).
    const data = new Uint8Array(
      frame.buffer,
      frame.byteOffset,
      frame.byteLength,
    );
    const palette = quantize(data, 256, { format: 'rgba4444' });
    const indexed = applyPalette(data, palette, 'rgba4444');
    enc.writeFrame(indexed, width, height, {
      palette,
      delay: FRAME_DURATION_MS,
      transparent: true,
      transparentIndex: 0,
      repeat: loopCount,
    });
  }
  enc.finish();
  return Buffer.from(enc.bytes());
};

/**
 * Compose 16 frames into a 4x4 spritesheet PNG (row-major).
 */
export const encodeSpritesheet = async (
  frames: Buffer[],
  width: number,
  height: number,
): Promise<Buffer> => {
  if (frames.length !== 16) {
    throw new Error(
      `encodeSpritesheet expects exactly 16 frames, got ${frames.length}`,
    );
  }
  const sheetW = width * 4;
  const sheetH = height * 4;
  const composites = frames.map((frame, idx) => {
    const col = idx % 4;
    const row = Math.floor(idx / 4);
    return {
      input: frame,
      raw: { width, height, channels: 4 as const },
      top: row * height,
      left: col * width,
    };
  });
  return await sharp({
    create: {
      width: sheetW,
      height: sheetH,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
};
