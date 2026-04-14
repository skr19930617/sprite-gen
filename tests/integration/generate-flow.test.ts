// @vitest-environment node
//
// Integration test 8.8: /api/generate quota + regeneration semantics.
// Uses fully-mocked Supabase + admin clients so it can run in the standard test
// suite without external services. Asserts:
//
//   - First-time generation when user is at cap → 402
//   - Regeneration (originating_project_id set) when user is at cap → still succeeds
//   - Renderer timeout → 504, no draft artifacts left, generations row counted=false
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

const setEnv = () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
  process.env.STRIPE_SECRET_KEY = 'sk_x';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
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

const validSpec = {
  entity_type: 'fish',
  animation_type: 'swim_slow',
  required_regions: ['body', 'tail'],
  optional_regions: [],
  params: {
    speed: 'slow',
    amplitude: 'small',
    emphasis: 'none',
    loop: true,
  },
};

const validParams = validSpec.params;

const installCommonMocks = (
  draft: Record<string, unknown>,
  options: {
    plan?: 'free' | 'paid';
    monthlyCount?: number;
    renderImpl?: () => Promise<unknown>;
  } = {},
) => {
  const inserts: Array<{ table: string; row: unknown }> = [];
  const updates: Array<{ table: string; row: unknown }> = [];
  const removed: string[][] = [];

  const supabaseFrom = vi.fn((table: string) => {
    if (table === 'drafts') {
      return {
        select: () => ({
          eq: () => ({
            single: <T>() => Promise.resolve({ data: draft as T, error: null }),
          }),
        }),
        update: (row: unknown) => ({
          eq: () => {
            updates.push({ table, row });
            return Promise.resolve({ error: null });
          },
        }),
      };
    }
    if (table === 'profiles') {
      return {
        select: () => ({
          eq: () => ({
            single: <T>() =>
              Promise.resolve({
                data: { plan: options.plan ?? 'free' } as T,
                error: null,
              }),
          }),
        }),
      };
    }
    if (table === 'generations') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                gte: () =>
                  Promise.resolve({
                    count: options.monthlyCount ?? 0,
                    error: null,
                  }),
              }),
            }),
          }),
        }),
      };
    }
    return { insert: () => Promise.resolve({ error: null }) };
  });

  vi.doMock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({
      auth: {
        getUser: () =>
          Promise.resolve({
            data: { user: { id: 'user-uuid', email: 'u@x' } },
            error: null,
          }),
      },
      from: supabaseFrom,
      rpc: () => Promise.resolve({ data: null, error: null }),
    })),
  }));

  vi.doMock('@/lib/supabase/admin', () => ({
    createAdminClient: () => ({
      storage: {
        from: () => ({
          download: () =>
            Promise.resolve({
              data: { arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) },
              error: null,
            }),
          upload: () => Promise.resolve({ error: null }),
          remove: (paths: string[]) => {
            removed.push(paths);
            return Promise.resolve({ error: null });
          },
        }),
      },
      from: (table: string) => ({
        insert: (row: unknown) => {
          inserts.push({ table, row });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  }));

  if (options.renderImpl) {
    vi.doMock('@/server/renderer', async () => {
      const actual = (await vi.importActual('@/server/renderer')) as Record<
        string,
        unknown
      >;
      return { ...actual, render: options.renderImpl! };
    });
  } else {
    vi.doMock('@/server/renderer', () => ({
      render: async () => ({
        gif: Buffer.from('gif'),
        spritesheet: Buffer.from('sheet'),
        rendererVersion: 1,
        frameCount: 16,
        width: 32,
        height: 32,
        fellBackToBodyOnly: false,
      }),
      RenderTimeoutError: class RenderTimeoutError extends Error {},
    }));
  }
  return { inserts, updates, removed };
};

describe('/api/generate quota + regeneration', () => {
  it('blocks first-time generation with 402 when user is at the cap', async () => {
    installCommonMocks(
      {
        id: 'draft-x',
        user_id: 'user-uuid',
        prompt: 'p',
        source_path: 'user-uuid/drafts/draft-x/source.png',
        mask_path: 'user-uuid/drafts/draft-x/mask.png',
        gif_path: null,
        spritesheet_path: null,
        project_json_path: null,
        llm_result: validSpec,
        final_animation_type: 'swim_slow',
        final_params: validParams,
        originating_project_id: null,
        created_at: new Date().toISOString(),
      },
      { plan: 'free', monthlyCount: 10 },
    );
    const { POST } = await import('@/app/api/generate/route');
    const res = await POST(
      new Request('http://localhost/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draft_id: 'draft-x' }),
      }),
    );
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.code).toBe('quota_exceeded');
    expect(body.cap).toBe(10);
  });

  it('regeneration succeeds even when user is at the cap', async () => {
    const tracker = installCommonMocks(
      {
        id: 'draft-r',
        user_id: 'user-uuid',
        prompt: 'p',
        source_path: 'p/source.png',
        mask_path: 'p/mask.png',
        gif_path: 'p/result.gif',
        spritesheet_path: null,
        project_json_path: null,
        llm_result: validSpec,
        final_animation_type: 'swim_slow',
        final_params: validParams,
        originating_project_id: '00000000-0000-0000-0000-000000000099',
        created_at: new Date().toISOString(),
      },
      { plan: 'free', monthlyCount: 10 },
    );
    const { POST } = await import('@/app/api/generate/route');
    const res = await POST(
      new Request('http://localhost/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draft_id: 'draft-r' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.is_regeneration).toBe(true);
    // generations row was inserted with counted=false
    const genInsert = tracker.inserts.find((i) => i.table === 'generations');
    expect(genInsert).toBeDefined();
    expect((genInsert!.row as { counted: boolean }).counted).toBe(false);
  });

  it('renderer timeout returns 504, marks counted=false, and removes partial artifacts', async () => {
    const RenderTimeoutErrorRef: { ctor?: new (msg: string) => Error } = {};
    const tracker = installCommonMocks(
      {
        id: 'draft-t',
        user_id: 'user-uuid',
        prompt: 'p',
        source_path: 'p/source.png',
        mask_path: 'p/mask.png',
        gif_path: null,
        spritesheet_path: null,
        project_json_path: null,
        llm_result: validSpec,
        final_animation_type: 'swim_slow',
        final_params: validParams,
        originating_project_id: null,
        created_at: new Date().toISOString(),
      },
      {
        plan: 'paid',
        monthlyCount: 0,
        renderImpl: async () => {
          // Pull the same RenderTimeoutError class the route imports.
          const m = (await import('@/server/renderer')) as unknown as {
            RenderTimeoutError: new (msg: string) => Error;
          };
          RenderTimeoutErrorRef.ctor = m.RenderTimeoutError;
          throw new m.RenderTimeoutError('test timeout');
        },
      },
    );
    const { POST } = await import('@/app/api/generate/route');
    const res = await POST(
      new Request('http://localhost/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draft_id: 'draft-t' }),
      }),
    );
    expect(RenderTimeoutErrorRef.ctor).toBeDefined();
    expect(res.status).toBe(504);
    const genInsert = tracker.inserts.find((i) => i.table === 'generations');
    expect((genInsert!.row as { counted: boolean }).counted).toBe(false);
    expect((genInsert!.row as { status: string }).status).toBe('timeout');
    expect(tracker.removed.length).toBeGreaterThan(0);
  });
});
