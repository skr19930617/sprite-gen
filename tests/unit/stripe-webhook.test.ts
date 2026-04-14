import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';

const ORIGINAL_ENV = { ...process.env };

const setEnv = () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
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

const installStripeMock = (
  constructEvent: (raw: string, sig: string, secret: string) => unknown,
) => {
  vi.doMock('stripe', () => ({
    default: class {
      webhooks = { constructEvent };
      customers = { create: vi.fn() };
      checkout = { sessions: { create: vi.fn() } };
    },
  }));
};

const installSupabaseMock = () => {
  const inserted: unknown[] = [];
  const updates: unknown[] = [];
  const fromImpl = vi.fn((table: string) => ({
    insert: (row: unknown) => {
      inserted.push({ table, row });
      return Promise.resolve({ error: null });
    },
    update: (row: unknown) => ({
      eq: (col: string, val: unknown) => {
        updates.push({ table, row, col, val });
        return Promise.resolve({ error: null });
      },
    }),
    select: () => ({
      eq: () => ({
        single: <T>() =>
          Promise.resolve({
            data: { id: 'user-uuid', stripe_customer_id: null } as T,
            error: null,
          }),
      }),
    }),
  }));
  vi.doMock('@/lib/supabase/admin', () => ({
    createAdminClient: () => ({ from: fromImpl }),
  }));
  return { inserted, updates };
};

const buildSignedRequest = (
  rawBody: string,
  secret = 'whsec_test',
): Request => {
  const ts = Math.floor(Date.now() / 1000);
  const signed = `${ts}.${rawBody}`;
  const sig = createHmac('sha256', secret).update(signed).digest('hex');
  const stripeSig = `t=${ts},v1=${sig}`;
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: {
      'stripe-signature': stripeSig,
      'content-type': 'application/json',
    },
    body: rawBody,
  });
};

describe('Stripe webhook handler', () => {
  it('rejects requests without a signature header (400)', async () => {
    installStripeMock(() => {
      throw new Error('not invoked');
    });
    installSupabaseMock();
    const { POST } = await import('@/app/api/stripe/webhook/route');
    const res = await POST(
      new Request('http://localhost/api/stripe/webhook', {
        method: 'POST',
        body: '{}',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when the signature fails verification', async () => {
    installStripeMock(() => {
      throw new Error('bad signature');
    });
    installSupabaseMock();
    const { POST } = await import('@/app/api/stripe/webhook/route');
    const res = await POST(buildSignedRequest('{}'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/signature/);
  });

  it('processes checkout.session.completed and persists the plan change', async () => {
    installStripeMock(() => ({
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: 'user-uuid',
          customer: 'cus_x',
        },
      },
    }));
    const { inserted, updates } = installSupabaseMock();
    const { POST } = await import('@/app/api/stripe/webhook/route');
    const res = await POST(buildSignedRequest('{}'));
    expect(res.status).toBe(200);
    expect(
      inserted.find((r) => (r as { table: string }).table === 'plan_changes'),
    ).toBeTruthy();
    expect(
      updates.find(
        (u) =>
          (u as { table: string }).table === 'profiles' &&
          (u as { row: { plan: string } }).row.plan === 'paid',
      ),
    ).toBeTruthy();
  });

  it('treats a duplicate stripe_event_id as already processed (idempotency)', async () => {
    installStripeMock(() => ({
      id: 'evt_dup',
      type: 'checkout.session.completed',
      data: {
        object: { client_reference_id: 'user-uuid', customer: 'cus_x' },
      },
    }));
    // Override admin mock so plan_changes insert returns 23505.
    vi.doMock('@/lib/supabase/admin', () => ({
      createAdminClient: () => ({
        from: (table: string) => ({
          insert: () =>
            Promise.resolve({
              error:
                table === 'plan_changes'
                  ? { code: '23505', message: 'duplicate key' }
                  : null,
            }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
      }),
    }));
    const { POST } = await import('@/app/api/stripe/webhook/route');
    const res = await POST(buildSignedRequest('{}'));
    // 200 OK and no further side effects (we just assert no 500).
    expect(res.status).toBe(200);
  });
});
