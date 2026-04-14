import { describe, expect, it } from 'vitest';
import {
  llmAnimationSpecSchema,
  animationParamsSchema,
} from '@/server/llm/schema';

const validSpec = {
  entity_type: 'fish',
  animation_type: 'eat',
  required_regions: ['body', 'tail', 'mouth'],
  optional_regions: ['fin'],
  params: { speed: 'slow', amplitude: 'small', emphasis: 'mouth', loop: true },
};

describe('llmAnimationSpecSchema', () => {
  it('accepts a fully-valid spec', () => {
    const res = llmAnimationSpecSchema.safeParse(validSpec);
    expect(res.success).toBe(true);
  });

  it('rejects unknown animation_type', () => {
    const res = llmAnimationSpecSchema.safeParse({
      ...validSpec,
      animation_type: 'dance',
    });
    expect(res.success).toBe(false);
  });

  it('rejects unknown region', () => {
    const res = llmAnimationSpecSchema.safeParse({
      ...validSpec,
      required_regions: ['eye'],
    });
    expect(res.success).toBe(false);
  });

  it('rejects extra param key', () => {
    const res = llmAnimationSpecSchema.safeParse({
      ...validSpec,
      params: { ...validSpec.params, acceleration: 1 },
    });
    expect(res.success).toBe(false);
  });

  it('rejects missing required key', () => {
    const { entity_type: _entity, ...rest } = validSpec;
    expect(_entity).toBe('fish');
    const res = llmAnimationSpecSchema.safeParse(rest);
    expect(res.success).toBe(false);
  });

  it('preserves loop=false through params schema', () => {
    const res = animationParamsSchema.safeParse({
      ...validSpec.params,
      loop: false,
    });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.loop).toBe(false);
  });
});
