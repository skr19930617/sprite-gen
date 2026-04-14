import { describe, expect, it } from 'vitest';
import { validatePngHeader, PNG_MAGIC } from '@/lib/image/png-validation';

const buildPng = (
  width: number,
  height: number,
  colorType: number,
  extraBytes = 0,
): Uint8Array => {
  // 8 magic + 4 length + 4 IHDR type + 13 IHDR data = 29 bytes minimum.
  const totalLen = 29 + extraBytes;
  const buf = new Uint8Array(totalLen);
  buf.set(PNG_MAGIC, 0);
  // IHDR chunk header
  buf[8] = 0;
  buf[9] = 0;
  buf[10] = 0;
  buf[11] = 13;
  buf[12] = 'I'.charCodeAt(0);
  buf[13] = 'H'.charCodeAt(0);
  buf[14] = 'D'.charCodeAt(0);
  buf[15] = 'R'.charCodeAt(0);
  // width / height (big-endian uint32)
  buf[16] = (width >>> 24) & 0xff;
  buf[17] = (width >>> 16) & 0xff;
  buf[18] = (width >>> 8) & 0xff;
  buf[19] = width & 0xff;
  buf[20] = (height >>> 24) & 0xff;
  buf[21] = (height >>> 16) & 0xff;
  buf[22] = (height >>> 8) & 0xff;
  buf[23] = height & 0xff;
  buf[24] = 8; // bit depth
  buf[25] = colorType;
  return buf;
};

describe('validatePngHeader', () => {
  it('accepts a 256x256 RGBA PNG', () => {
    const res = validatePngHeader(buildPng(256, 256, 6));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.width).toBe(256);
      expect(res.height).toBe(256);
      expect(res.hasAlpha).toBe(true);
    }
  });

  it('rejects a non-PNG buffer', () => {
    // Use a 64-byte buffer (>= 24 byte minimum) with bogus header.
    const buf = new Uint8Array(64);
    for (let i = 0; i < 8; i++) buf[i] = i;
    const res = validatePngHeader(buf);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('not_png');
  });

  it('rejects a 1024x1024 image as too large', () => {
    const res = validatePngHeader(buildPng(1024, 1024, 6));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('too_large_dimension');
  });

  it('rejects a non-alpha color type', () => {
    const res = validatePngHeader(buildPng(64, 64, 2)); // truecolor, no alpha
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('no_alpha_channel');
  });

  it('rejects buffers >2MB', () => {
    const huge = new Uint8Array(3 * 1024 * 1024);
    huge.set(PNG_MAGIC, 0);
    const res = validatePngHeader(huge);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('too_large_bytes');
  });
});
