/**
 * Client-safe PNG validation (no Node-only dependencies). Server-side route
 * handlers re-validate via sharp for trust.
 */

export const PNG_MAGIC = Uint8Array.of(
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
);
export const MAX_DIMENSION = 512;
export const MAX_BYTES = 2 * 1024 * 1024;

export type PngValidationOk = {
  ok: true;
  width: number;
  height: number;
  hasAlpha: boolean;
  hasTransparentPixel: boolean;
};

export type PngValidationError = {
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

export type PngValidationResult = PngValidationOk | PngValidationError;

const MSG: Record<PngValidationError['code'], string> = {
  not_png: '透過 PNG が必要です',
  too_large_bytes: 'ファイルサイズは 2MB 以下にしてください',
  too_large_dimension: '画像サイズは 512x512 以下にしてください',
  invalid_png: 'PNG ファイルが破損しています',
  no_alpha_channel: '透過 PNG が必要です',
  fully_opaque: '透過部分のある PNG が必要です',
};

const fail = (code: PngValidationError['code']): PngValidationError => ({
  ok: false,
  code,
  message: MSG[code],
});

const equalBytes = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

const readUInt32BE = (buf: Uint8Array, offset: number): number =>
  ((buf[offset] ?? 0) << 24) |
  ((buf[offset + 1] ?? 0) << 16) |
  ((buf[offset + 2] ?? 0) << 8) |
  (buf[offset + 3] ?? 0);

/**
 * Validate a PNG buffer:
 * - magic bytes
 * - IHDR width/height ≤ 512
 * - color type indicates alpha (4 = grayscale+alpha, 6 = RGBA), or palette (3) with tRNS chunk
 * Does NOT verify transparent-pixel presence (that requires full decode);
 * server uses `sharp().stats()` for that.
 */
export const validatePngHeader = (bytes: Uint8Array): PngValidationResult => {
  if (bytes.byteLength > MAX_BYTES) return fail('too_large_bytes');
  if (bytes.byteLength < 24) return fail('invalid_png');
  if (!equalBytes(bytes.slice(0, 8), PNG_MAGIC)) return fail('not_png');

  // IHDR chunk starts at offset 8: 4-byte length, 4-byte type "IHDR", then 13 bytes.
  const ihdrType = String.fromCharCode(...bytes.slice(12, 16));
  if (ihdrType !== 'IHDR') return fail('invalid_png');

  const width = readUInt32BE(bytes, 16);
  const height = readUInt32BE(bytes, 20);
  if (width === 0 || height === 0) return fail('invalid_png');
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    return fail('too_large_dimension');
  }

  const colorType = bytes[25] ?? -1;
  // 4 = grayscale+alpha, 6 = RGBA. Palette (3) needs a tRNS chunk; for MVP
  // we require true alpha channel.
  const hasAlphaChannel = colorType === 4 || colorType === 6;
  if (!hasAlphaChannel) {
    return fail('no_alpha_channel');
  }

  return {
    ok: true,
    width,
    height,
    hasAlpha: true,
    hasTransparentPixel: true, // optimistic; server confirms with sharp().stats()
  };
};
