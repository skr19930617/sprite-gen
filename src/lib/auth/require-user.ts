import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { User } from '@supabase/supabase-js';

export type AuthSuccess = {
  ok: true;
  user: User;
  supabase: Awaited<ReturnType<typeof createClient>>;
};

export type AuthFailure = { ok: false; response: NextResponse };

/**
 * Route-handler helper: returns the authenticated user + a Supabase server
 * client, or a NextResponse(401) shortcut if no session exists.
 */
export const requireUser = async (): Promise<AuthSuccess | AuthFailure> => {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
    };
  }
  return { ok: true, user, supabase };
};
