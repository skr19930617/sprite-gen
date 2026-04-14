// @vitest-environment node
//
// Integration test 8.8/12.6: malicious-user RLS audit + generate-quota path.
// Requires a real Supabase project. Gate via RUN_LIVE_SUPABASE=1.
//
// Required env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   SUPABASE_TEST_USER_A_EMAIL / _PASSWORD,
//   SUPABASE_TEST_USER_B_EMAIL / _PASSWORD,
//
// User A creates a draft + project; user B MUST NOT be able to read or modify it.
import { describe, it, expect, beforeAll } from 'vitest';
import {
  createClient as createSb,
  type SupabaseClient,
} from '@supabase/supabase-js';

const liveDescribe =
  process.env.RUN_LIVE_SUPABASE === '1' ? describe : describe.skip;

liveDescribe('Supabase RLS isolation (gated by RUN_LIVE_SUPABASE=1)', () => {
  let admin: SupabaseClient;
  let userAClient: SupabaseClient;
  let userBClient: SupabaseClient;
  let userAId: string;

  beforeAll(async () => {
    const url = process.env.SUPABASE_URL;
    const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const aEmail = process.env.SUPABASE_TEST_USER_A_EMAIL;
    const aPwd = process.env.SUPABASE_TEST_USER_A_PASSWORD;
    const bEmail = process.env.SUPABASE_TEST_USER_B_EMAIL;
    const bPwd = process.env.SUPABASE_TEST_USER_B_PASSWORD;
    if (!url || !svc || !aEmail || !aPwd || !bEmail || !bPwd) {
      throw new Error('missing required Supabase test env vars');
    }
    const anon = process.env.SUPABASE_ANON_KEY ?? svc;
    admin = createSb(url, svc, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    userAClient = createSb(url, anon);
    userBClient = createSb(url, anon);
    const aSignIn = await userAClient.auth.signInWithPassword({
      email: aEmail,
      password: aPwd,
    });
    const bSignIn = await userBClient.auth.signInWithPassword({
      email: bEmail,
      password: bPwd,
    });
    if (aSignIn.error) throw aSignIn.error;
    if (bSignIn.error) throw bSignIn.error;
    userAId = aSignIn.data.user!.id;
  });

  it('user A can insert a draft owned by themselves', async () => {
    const r = await userAClient
      .from('drafts')
      .insert({
        user_id: userAId,
        prompt: 'rls-test-' + Date.now(),
        source_path: 'placeholder',
      })
      .select('id')
      .single();
    expect(r.error).toBeNull();
    expect(r.data?.id).toBeTruthy();
    if (r.data?.id) {
      await admin.from('drafts').delete().eq('id', r.data.id);
    }
  });

  it('user B cannot read user A drafts', async () => {
    const r = await userBClient
      .from('drafts')
      .select('id')
      .eq('user_id', userAId);
    // RLS returns an empty list (not an error) — must NOT leak A's rows.
    expect(r.error).toBeNull();
    expect(r.data ?? []).toHaveLength(0);
  });

  it('user B cannot update user A drafts even with the row id', async () => {
    // Seed an A-owned draft with the service role.
    const seed = await admin
      .from('drafts')
      .insert({
        user_id: userAId,
        prompt: 'rls-victim',
        source_path: 'placeholder',
      })
      .select('id')
      .single();
    expect(seed.error).toBeNull();
    const draftId = seed.data!.id as string;
    try {
      const upd = await userBClient
        .from('drafts')
        .update({ prompt: 'pwned' })
        .eq('id', draftId);
      // RLS-rejected updates either error or affect zero rows; both are acceptable.
      const audit = await admin
        .from('drafts')
        .select('prompt')
        .eq('id', draftId)
        .single<{ prompt: string }>();
      expect(audit.data?.prompt).toBe('rls-victim');
      void upd;
    } finally {
      await admin.from('drafts').delete().eq('id', draftId);
    }
  });
});
