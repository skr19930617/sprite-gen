import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

const setEnv = () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
};

beforeEach(() => {
  vi.resetModules();
  setEnv();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('supabase client factories', () => {
  it('createBrowserClient is invoked with public env', async () => {
    const createBrowserClient = vi.fn(() => ({ tag: 'browser' }));
    vi.doMock('@supabase/ssr', () => ({ createBrowserClient }));
    const { createClient } = await import('@/lib/supabase/client');
    const c = createClient();
    expect(createBrowserClient).toHaveBeenCalledWith(
      'https://test.supabase.co',
      'anon-key',
    );
    expect(c).toEqual({ tag: 'browser' });
  });

  it('admin client uses service-role and disables session persistence', async () => {
    const createSbClient = vi.fn(() => ({ tag: 'admin' }));
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: createSbClient,
    }));
    const { createAdminClient } = await import('@/lib/supabase/admin');
    createAdminClient();
    expect(createSbClient).toHaveBeenCalledWith(
      'https://test.supabase.co',
      'service-role-key',
      expect.objectContaining({
        auth: expect.objectContaining({
          persistSession: false,
          autoRefreshToken: false,
        }),
      }),
    );
  });

  it('env reader throws when a required variable is missing', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { env } = await import('@/lib/env');
    expect(() => env.SUPABASE_SERVICE_ROLE_KEY).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
  });
});
