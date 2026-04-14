import sharp from 'sharp';
import { MAX_DIMENSION, validatePngHeader } from '@/lib/image/png-validation';

export type ServerPngValidation =
  | {
      ok: true;
      width: number;
      height: number;
      hasTransparentPixel: boolean;
    }
  | {
      ok: false;
      code:
        | 'not_png'
        | 'too_large_bytes'
        | 'too_large_dimension'
        | 'invalid_png'
        | 'no_alpha_channel'
        | 'fully_opaque';
      message: string;
    };

/**
 * Server-side PNG validation: re-checks magic + dimensions, then uses sharp to
 * confirm an actual transparent pixel exists (alpha min < 255).
 */
export const validatePngBuffer = async (
  bytes: Buffer,
): Promise<ServerPngValidation> => {
  const headerCheck = validatePngHeader(new Uint8Array(bytes));
  if (!headerCheck.ok) return headerCheck;

  let metadata: sharp.Metadata;
  let stats: sharp.Stats;
  try {
    const image = sharp(bytes);
    [metadata, stats] = await Promise.all([image.metadata(), image.stats()]);
  } catch {
    return {
      ok: false,
      code: 'invalid_png',
      message: 'PNG ファイルが破損しています',
    };
  }

  if (metadata.format !== 'png') {
    return { ok: false, code: 'not_png', message: '透過 PNG が必要です' };
  }
  const w = metadata.width ?? 0;
  const h = metadata.height ?? 0;
  if (w === 0 || h === 0) {
    return {
      ok: false,
      code: 'invalid_png',
      message: 'PNG ファイルが破損しています',
    };
  }
  if (w > MAX_DIMENSION || h > MAX_DIMENSION) {
    return {
      ok: false,
      code: 'too_large_dimension',
      message: '画像サイズは 512x512 以下にしてください',
    };
  }
  if (!metadata.hasAlpha) {
    return {
      ok: false,
      code: 'no_alpha_channel',
      message: '透過 PNG が必要です',
    };
  }

  // sharp.stats().channels[3] is the alpha channel for RGBA.
  const alphaChannel = stats.channels[stats.channels.length - 1];
  if (!alphaChannel || alphaChannel.min >= 255) {
    return {
      ok: false,
      code: 'fully_opaque',
      message: '透過部分のある PNG が必要です',
    };
  }
  return { ok: true, width: w, height: h, hasTransparentPixel: true };
};
