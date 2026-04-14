import sharp from 'sharp';

/**
 * Extract a region patch from a source RGBA buffer using a boolean mask.
 * Pixels outside the mask are written as fully transparent.
 * Returns a fresh RGBA buffer of the same dimensions.
 */
export const extractPatch = (
  width: number,
  height: number,
  sourceRgba: Buffer,
  mask: Uint8Array,
): Buffer => {
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    if (mask[i] === 1) {
      const o = i * 4;
      out[o] = sourceRgba[o] ?? 0;
      out[o + 1] = sourceRgba[o + 1] ?? 0;
      out[o + 2] = sourceRgba[o + 2] ?? 0;
      out[o + 3] = sourceRgba[o + 3] ?? 0;
    }
  }
  return out;
};

/**
 * Compute the bounding box of set pixels in a mask. Returns null when empty.
 */
export const maskBoundingBox = (
  width: number,
  height: number,
  mask: Uint8Array,
): { left: number; top: number; right: number; bottom: number } | null => {
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] === 1) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return null;
  return { left, top, right, bottom };
};

export type AffineParams = {
  /** Rotation in degrees applied around the patch pivot. */
  rotateDeg?: number;
  /** Translation in pixels (x, y). */
  translateX?: number;
  translateY?: number;
  /** Uniform scale (1.0 = no change). */
  scale?: number;
};

/**
 * Apply an affine transform to a patch buffer using sharp. The patch
 * dimensions are preserved (we composite back onto a frame of the original
 * canvas size in the caller).
 */
export const transformPatch = async (
  width: number,
  height: number,
  patch: Buffer,
  params: AffineParams,
): Promise<Buffer> => {
  let pipeline = sharp(patch, {
    raw: { width, height, channels: 4 },
  });
  if (params.scale && params.scale !== 1) {
    const newW = Math.max(1, Math.round(width * params.scale));
    const newH = Math.max(1, Math.round(height * params.scale));
    pipeline = pipeline.resize(newW, newH, { kernel: 'nearest' });
  }
  if (params.rotateDeg && params.rotateDeg !== 0) {
    pipeline = pipeline.rotate(params.rotateDeg, {
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  }
  const transformedPng = await pipeline.png().toBuffer();
  const transformedMeta = await sharp(transformedPng).metadata();
  const tw = transformedMeta.width ?? width;
  const th = transformedMeta.height ?? height;

  // Center the (potentially larger) transformed patch back inside the original
  // canvas, applying the optional translation.
  const baseLeft = Math.round((width - tw) / 2) + (params.translateX ?? 0);
  const baseTop = Math.round((height - th) / 2) + (params.translateY ?? 0);

  // Pad / crop transformedPng so it fits within the base canvas.
  const cropLeft = Math.max(0, -baseLeft);
  const cropTop = Math.max(0, -baseTop);
  const cropWidth = Math.min(tw - cropLeft, width - Math.max(0, baseLeft));
  const cropHeight = Math.min(th - cropTop, height - Math.max(0, baseTop));

  if (cropWidth <= 0 || cropHeight <= 0) {
    // The patch fell entirely off-canvas — return a fully transparent buffer.
    return Buffer.alloc(width * height * 4);
  }

  const cropped =
    cropLeft === 0 && cropTop === 0 && cropWidth === tw && cropHeight === th
      ? transformedPng
      : await sharp(transformedPng)
          .extract({
            left: cropLeft,
            top: cropTop,
            width: cropWidth,
            height: cropHeight,
          })
          .png()
          .toBuffer();

  const composited = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: cropped,
        top: Math.max(0, baseTop),
        left: Math.max(0, baseLeft),
        blend: 'over',
      },
    ])
    .raw()
    .toBuffer();
  return composited;
};

/**
 * Composite a transformed patch onto the base RGBA frame (mutating in place).
 */
export const compositeOntoBase = (
  width: number,
  height: number,
  base: Buffer,
  patch: Buffer,
): void => {
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const a = patch[o + 3] ?? 0;
    if (a === 0) continue;
    base[o] = patch[o] ?? 0;
    base[o + 1] = patch[o + 1] ?? 0;
    base[o + 2] = patch[o + 2] ?? 0;
    base[o + 3] = a;
  }
};
