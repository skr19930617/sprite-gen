// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';

const liveDescribe =
  process.env.RUN_LIVE_ANTHROPIC === '1' ? describe : describe.skip;

liveDescribe(
  'Anthropic live integration (gated by RUN_LIVE_ANTHROPIC=1)',
  () => {
    beforeAll(() => {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY required for live integration');
      }
      process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
      process.env.STRIPE_SECRET_KEY = 'sk_test';
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec';
      process.env.STRIPE_PRICE_ID_MONTHLY = 'price';
    });

    it('parses a real Japanese prompt into a valid LlmAnimationSpec', async () => {
      const { parsePrompt } = await import('@/server/llm/parse-prompt');
      const spec = await parsePrompt('餌に近づいて口をぱくっと開ける', {
        timeoutMs: 15_000,
      });
      expect(spec.entity_type).toBe('fish');
      expect(['swim_slow', 'turn', 'approach_food', 'eat']).toContain(
        spec.animation_type,
      );
      expect(spec.required_regions).toContain('body');
      expect(typeof spec.params.loop).toBe('boolean');
    }, 30_000);

    it('parses an English "swim slowly" prompt', async () => {
      const { parsePrompt } = await import('@/server/llm/parse-prompt');
      const spec = await parsePrompt('the fish swims slowly to the right', {
        timeoutMs: 15_000,
      });
      expect(
        spec.animation_type === 'swim_slow' ||
          spec.animation_type === 'approach_food',
      ).toBe(true);
    }, 30_000);
  },
);
