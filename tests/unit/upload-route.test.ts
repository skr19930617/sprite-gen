// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import sharp from 'sharp';

const ORIGINAL_ENV = { ...process.env };

const setEnv = () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
  process.env.ANTHROPIC_API_KEY = 'sk-x';
  process.env.STRIPE_SECRET_KEY = 'sk_x';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
  process.env.STRIPE_PRICE_ID_MONTHLY = 'price_x';
};

beforeEach(() => {
  vi.resetModules();
  setEnv();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

const TEST_USER = { id: 'user-uuid', email: 'u@example.com' };

const buildTransparentPng = async (): Promise<Buffer> => {
  const w = 32;
  const h = 32;
  const rgba = Buffer.alloc(w * h * 4);
  // Half opaque orange, half transparent.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (x < w / 2) {
        rgba[o] = 240;
        rgba[o + 1] = 160;
        rgba[o + 2] = 80;
        rgba[o + 3] = 255;
      }
    }
  }
  return await sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toBuffer();
};

const buildOpaquePng = async (): Promise<Buffer> => {
  // Fully opaque (alpha min == 255) — should be rejected.
  const w = 32;
  const h = 32;
  const rgba = Buffer.alloc(w * h * 4, 255);
  return await sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toBuffer();
};

const installSupabaseMocks = (
  parseImpl: () => Promise<unknown>,
  options: {
    insertError?: unknown;
    uploadError?: unknown;
    updateError?: unknown;
  } = {},
) => {
  const insertedDrafts: unknown[] = [];
  const updatedDrafts: unknown[] = [];
  const deletedDraftIds: string[] = [];
  const uploadedPaths: string[] = [];
  const removedPaths: string[][] = [];

  const fromImpl = vi.fn((table: string) => {
    if (table === 'drafts') {
      return {
        insert: (row: unknown) => ({
          select: () => ({
            single: () => {
              insertedDrafts.push(row);
              if (options.insertError) {
                return Promise.resolve({
                  data: null,
                  error: options.insertError,
                });
              }
              return Promise.resolve({
                data: {
                  id: 'draft-uuid',
                  created_at: new Date().toISOString(),
                },
                error: null,
              });
            },
          }),
        }),
        update: (row: unknown) => ({
          eq: (_col: string, val: string) => {
            updatedDrafts.push({ row, id: val });
            return Promise.resolve({ error: options.updateError ?? null });
          },
        }),
        delete: () => ({
          eq: (_col: string, val: string) => {
            deletedDraftIds.push(val);
            return Promise.resolve({ error: null });
          },
        }),
      };
    }
    return { insert: () => Promise.resolve({ error: null }) };
  });

  vi.doMock('@/lib/supabase/server', () => ({
    createClient: vi.fn(async () => ({
      auth: {
        getUser: () =>
          Promise.resolve({ data: { user: TEST_USER }, error: null }),
      },
      from: fromImpl,
    })),
  }));

  vi.doMock('@/lib/supabase/admin', () => ({
    createAdminClient: () => ({
      storage: {
        from: () => ({
          upload: (path: string) => {
            uploadedPaths.push(path);
            return Promise.resolve({ error: options.uploadError ?? null });
          },
          remove: (paths: string[]) => {
            removedPaths.push(paths);
            return Promise.resolve({ error: null });
          },
        }),
      },
    }),
  }));

  vi.doMock('@/server/llm/parse-prompt', () => ({ parsePrompt: parseImpl }));

  return {
    insertedDrafts,
    updatedDrafts,
    deletedDraftIds,
    uploadedPaths,
    removedPaths,
  };
};

const buildMultipartRequest = async (
  png: Buffer,
  prompt: string,
  contentType?: string,
): Promise<Request> => {
  const form = new FormData();
  const pngBytes = new Uint8Array(png);
  form.append(
    'file',
    new Blob([pngBytes], { type: contentType ?? 'image/png' }),
    'fish.png',
  );
  form.append('prompt', prompt);
  return new Request('http://localhost/api/upload', {
    method: 'POST',
    body: form,
  });
};

const validSpec = {
  entity_type: 'fish',
  animation_type: 'swim_slow',
  required_regions: ['body', 'tail'],
  optional_regions: ['fin'],
  params: {
    speed: 'slow',
    amplitude: 'small',
    emphasis: 'none',
    loop: true,
  },
};

describe('/api/upload route', () => {
  it('returns 400 when prompt is missing', async () => {
    installSupabaseMocks(async () => validSpec);
    const png = await buildTransparentPng();
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(png)], { type: 'image/png' }),
      'f.png',
    );
    const req = new Request('http://localhost/api/upload', {
      method: 'POST',
      body: form,
    });
    const { POST } = await import('@/app/api/upload/route');
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 415 when content-type is not multipart', async () => {
    installSupabaseMocks(async () => validSpec);
    const req = new Request('http://localhost/api/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const { POST } = await import('@/app/api/upload/route');
    const res = await POST(req);
    expect(res.status).toBe(415);
  });

  it('rejects fully-opaque PNG with code fully_opaque', async () => {
    installSupabaseMocks(async () => validSpec);
    const png = await buildOpaquePng();
    const req = await buildMultipartRequest(png, 'ゆっくり泳ぐ');
    const { POST } = await import('@/app/api/upload/route');
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('fully_opaque');
  });

  it('persists the draft + LLM result on the success path', async () => {
    const mocks = installSupabaseMocks(async () => validSpec);
    const png = await buildTransparentPng();
    const req = await buildMultipartRequest(png, '餌を食べる');
    const { POST } = await import('@/app/api/upload/route');
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.draft_id).toBe('draft-uuid');
    expect(body.next).toMatch(/\/drafts\/draft-uuid\/mask/);
    expect(mocks.uploadedPaths.some((p) => p.endsWith('/source.png'))).toBe(
      true,
    );
    expect(mocks.updatedDrafts).toHaveLength(1);
    expect(
      (mocks.updatedDrafts[0] as { row: { llm_result: unknown } }).row
        .llm_result,
    ).toEqual(validSpec);
    expect(mocks.deletedDraftIds).toHaveLength(0);
  });

  it('rolls back on InvalidLlmResponseError → 422 + draft & source removed', async () => {
    const { InvalidLlmResponseError } = await import('@/server/llm/errors');
    const mocks = installSupabaseMocks(async () => {
      throw new InvalidLlmResponseError('bad schema');
    });
    const png = await buildTransparentPng();
    const req = await buildMultipartRequest(png, '謎の動き');
    const { POST } = await import('@/app/api/upload/route');
    const res = await POST(req);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('invalid_llm_response');
    expect(
      mocks.removedPaths.flat().some((p) => p.endsWith('/source.png')),
    ).toBe(true);
    expect(mocks.deletedDraftIds).toContain('draft-uuid');
  });

  it('returns 504 + rolls back on LlmTimeoutError', async () => {
    const { LlmTimeoutError } = await import('@/server/llm/errors');
    const mocks = installSupabaseMocks(async () => {
      throw new LlmTimeoutError('timeout');
    });
    const png = await buildTransparentPng();
    const req = await buildMultipartRequest(png, '泳ぐ');
    const { POST } = await import('@/app/api/upload/route');
    const res = await POST(req);
    expect(res.status).toBe(504);
    expect(mocks.deletedDraftIds).toContain('draft-uuid');
  });

  it('returns 502 + rolls back on LlmUpstreamError', async () => {
    const { LlmUpstreamError } = await import('@/server/llm/errors');
    const mocks = installSupabaseMocks(async () => {
      throw new LlmUpstreamError('upstream 500');
    });
    const png = await buildTransparentPng();
    const req = await buildMultipartRequest(png, '泳ぐ');
    const { POST } = await import('@/app/api/upload/route');
    const res = await POST(req);
    expect(res.status).toBe(502);
    expect(mocks.deletedDraftIds).toContain('draft-uuid');
  });
});
