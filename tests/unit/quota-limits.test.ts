import { describe, expect, it } from 'vitest';
import { PLAN_LIMITS, isPlan } from '@/lib/quota/limits';
import { isOverGenerationCap, isOverSaveCap } from '@/lib/quota/usage';

describe('PLAN_LIMITS', () => {
  it('matches the proposal numbers', () => {
    expect(PLAN_LIMITS.free.generationsPerMonth).toBe(10);
    expect(PLAN_LIMITS.free.savedProjects).toBe(5);
    expect(PLAN_LIMITS.free.commercialUseAllowed).toBe(false);
    expect(PLAN_LIMITS.paid.generationsPerMonth).toBe(200);
    expect(PLAN_LIMITS.paid.savedProjects).toBe(100);
    expect(PLAN_LIMITS.paid.commercialUseAllowed).toBe(true);
  });

  it('isPlan narrows correctly', () => {
    expect(isPlan('free')).toBe(true);
    expect(isPlan('paid')).toBe(true);
    expect(isPlan('enterprise')).toBe(false);
  });

  it('blocks at the cap, not above it', () => {
    expect(isOverGenerationCap(9, 'free')).toBe(false);
    expect(isOverGenerationCap(10, 'free')).toBe(true);
    expect(isOverSaveCap(4, 'free')).toBe(false);
    expect(isOverSaveCap(5, 'free')).toBe(true);
    expect(isOverSaveCap(99, 'paid')).toBe(false);
    expect(isOverSaveCap(100, 'paid')).toBe(true);
  });
});
