import { describe, expect, it } from 'vitest';
import { mapParams } from '@/server/renderer/params';

describe('renderer params mapping', () => {
  it('maps speed slow → 0.7, medium → 1.0', () => {
    expect(
      mapParams({
        speed: 'slow',
        amplitude: 'medium',
        emphasis: 'none',
        loop: true,
      }).speed,
    ).toBeCloseTo(0.7);
    expect(
      mapParams({
        speed: 'medium',
        amplitude: 'medium',
        emphasis: 'none',
        loop: true,
      }).speed,
    ).toBe(1);
  });

  it('maps amplitude small → 5°, medium → 12°', () => {
    expect(
      mapParams({
        speed: 'medium',
        amplitude: 'small',
        emphasis: 'none',
        loop: true,
      }).amplitudeDeg,
    ).toBe(5);
    expect(
      mapParams({
        speed: 'medium',
        amplitude: 'medium',
        emphasis: 'none',
        loop: true,
      }).amplitudeDeg,
    ).toBe(12);
  });

  it('emphasis none → multiplier 1, region null', () => {
    const r = mapParams({
      speed: 'medium',
      amplitude: 'medium',
      emphasis: 'none',
      loop: true,
    });
    expect(r.emphasisMultiplier).toBe(1);
    expect(r.emphasisRegion).toBeNull();
  });

  it('emphasis tail → multiplier 1.5, region tail', () => {
    const r = mapParams({
      speed: 'medium',
      amplitude: 'medium',
      emphasis: 'tail',
      loop: true,
    });
    expect(r.emphasisMultiplier).toBe(1.5);
    expect(r.emphasisRegion).toBe('tail');
  });

  it('loop true → 0 (infinite), false → 1 (single play)', () => {
    expect(
      mapParams({
        speed: 'medium',
        amplitude: 'medium',
        emphasis: 'none',
        loop: true,
      }).gifLoopCount,
    ).toBe(0);
    expect(
      mapParams({
        speed: 'medium',
        amplitude: 'medium',
        emphasis: 'none',
        loop: false,
      }).gifLoopCount,
    ).toBe(1);
  });
});
