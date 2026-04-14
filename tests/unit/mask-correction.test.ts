import { describe, expect, it } from 'vitest';
import {
  applyMaskCorrection,
  clipToOpacity,
  fillSmallHoles,
  removeIsolatedPixels,
  countSetPixels,
  type MaskBuffer,
} from '@/lib/mask/correction';

const make = (w: number, h: number, data: number[]): MaskBuffer => ({
  width: w,
  height: h,
  data: new Uint8Array(data),
});

describe('mask correction', () => {
  it('clipToOpacity removes pixels outside the alpha mask', () => {
    const mask = make(3, 1, [1, 1, 1]);
    const alpha = new Uint8Array([1, 0, 1]);
    const out = clipToOpacity(mask, alpha);
    expect(Array.from(out.data)).toEqual([1, 0, 1]);
  });

  it('fillSmallHoles fills a single hole surrounded by 4 neighbours', () => {
    const mask = make(3, 3, [0, 1, 0, 1, 0, 1, 0, 1, 0]);
    const out = fillSmallHoles(mask);
    expect(out.data[4]).toBe(1);
  });

  it('fillSmallHoles respects alphaMap if provided', () => {
    const mask = make(3, 3, [0, 1, 0, 1, 0, 1, 0, 1, 0]);
    const alpha = new Uint8Array([1, 1, 1, 1, 0, 1, 1, 1, 1]);
    const out = fillSmallHoles(mask, alpha);
    // center is transparent → cannot be filled
    expect(out.data[4]).toBe(0);
  });

  it('removeIsolatedPixels strips lonely pixels but keeps clusters', () => {
    const mask = make(5, 1, [1, 0, 0, 1, 1]);
    const out = removeIsolatedPixels(mask);
    expect(Array.from(out.data)).toEqual([0, 0, 0, 1, 1]);
  });

  it('applyMaskCorrection runs all three filters in order', () => {
    const mask = make(3, 3, [0, 1, 0, 1, 0, 1, 0, 1, 1]);
    const alpha = new Uint8Array([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const out = applyMaskCorrection(mask, alpha);
    expect(out.data[4]).toBe(1); // center hole filled
    expect(countSetPixels(out)).toBeGreaterThan(0);
  });

  it('applyMaskCorrection clips out-of-opacity pixels', () => {
    const mask = make(3, 1, [1, 1, 1]);
    const alpha = new Uint8Array([1, 0, 0]);
    const out = applyMaskCorrection(mask, alpha);
    expect(out.data[1]).toBe(0);
    expect(out.data[2]).toBe(0);
  });
});
