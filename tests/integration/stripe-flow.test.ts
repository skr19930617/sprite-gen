// @vitest-environment node
//
// Integration test 10.11: Stripe webhook → plan transitions raise/lower caps.
// This test exercises the webhook handler with hand-crafted real-format events
// and a mocked admin client; it does NOT call the live Stripe API.
//
// Gated by RUN_STRIPE_FLOW=1 because it needs Phase C-level fixture wiring.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { PLAN_LIMITS } from '@/lib/quota/limits';

const ORIGINAL_ENV = { ...process.env };

const setEnv = () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
  process.env.STRIPE_SECRET_KEY = 'sk_test';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_t';
  process.env.STRIPE_PRICE_ID_MONTHLY = 'price_x';
  process.env.ANTHROPIC_API_KEY = 'sk-x';
};

beforeEach(() => {
  vi.resetModules();
  setEnv();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

const liveDescribe =
  process.env.RUN_STRIPE_FLOW === '1' ? describe : describe.skip;

const installStripe = (event: unknown) => {
  vi.doMock('stripe', () => ({
    default: class {
      webhooks = { constructEvent: () => event };
      customers = { create: vi.fn() };
      checkout = { sessions: { create: vi.fn() } };
    },
  }));
};

const buildSignedRequest = (body: string): Request => {
  const ts = Math.floor(Date.now() / 1000);
  const signed = `${ts}.${body}`;
  const sig = createHmac('sha256', 'whsec_t').update(signed).digest('hex');
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': `t=${ts},v1=${sig}` },
    body,
  });
};

const installAdminTrack = () => {
  const planUpdates: Array<{ id: string; plan: string }> = [];
  const planChanges: unknown[] = [];
  vi.doMock('@/lib/supabase/admin', () => ({
    createAdminClient: () => ({
      from: (table: string) => ({
        insert: (row: unknown) => {
          if (table === 'plan_changes') planChanges.push(row);
          return Promise.resolve({ error: null });
        },
        update: (row: { plan?: string }) => ({
          eq: (_col: string, val: string) => {
            if (table === 'profiles' && row.plan) {
              planUpdates.push({ id: val, plan: row.plan });
            }
            return Promise.resolve({ error: null });
          },
        }),
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: { id: 'user-uuid', stripe_customer_id: 'cus_x' },
                error: null,
              }),
          }),
        }),
      }),
    }),
  }));
  return { planUpdates, planChanges };
};

liveDescribe(
  'Stripe webhook plan transitions (gated by RUN_STRIPE_FLOW=1)',
  () => {
    it('checkout.session.completed promotes user to paid (raises caps to 200/100)', async () => {
      installStripe({
        id: 'evt_chk',
        type: 'checkout.session.completed',
        data: {
          object: { client_reference_id: 'user-uuid', customer: 'cus_x' },
        },
      });
      const tracker = installAdminTrack();
      const { POST } = await import('@/app/api/stripe/webhook/route');
      const res = await POST(buildSignedRequest('{}'));
      expect(res.status).toBe(200);
      const upgrade = tracker.planUpdates.find(
        (u) => u.id === 'user-uuid' && u.plan === 'paid',
      );
      expect(upgrade).toBeDefined();
      // Caps assertion: paid plan exposes the proposal numbers.
      expect(PLAN_LIMITS.paid.generationsPerMonth).toBe(200);
      expect(PLAN_LIMITS.paid.savedProjects).toBe(100);
    });

    it('customer.subscription.deleted downgrades to free (caps drop to 10/5)', async () => {
      installStripe({
        id: 'evt_del',
        type: 'customer.subscription.deleted',
        data: { object: { customer: 'cus_x' } },
      });
      const tracker = installAdminTrack();
      const { POST } = await import('@/app/api/stripe/webhook/route');
      const res = await POST(buildSignedRequest('{}'));
      expect(res.status).toBe(200);
      const downgrade = tracker.planUpdates.find(
        (u) => u.id === 'user-uuid' && u.plan === 'free',
      );
      expect(downgrade).toBeDefined();
      expect(PLAN_LIMITS.free.generationsPerMonth).toBe(10);
      expect(PLAN_LIMITS.free.savedProjects).toBe(5);
    });
  },
);
