import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { env } from '@/lib/env';

type CookieToSet = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

/**
 * Refresh the user session and return the augmented response. Called from
 * the root middleware.ts. Mutates `response.cookies` so updated tokens flow
 * back to the browser.
 */
export const updateSession = async (
  request: NextRequest,
): Promise<{ response: NextResponse; user: User | null }> => {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet: CookieToSet[]) => {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  let user: User | null = null;
  try {
    const res = await supabase.auth.getUser();
    user = res.data.user ?? null;
  } catch {
    // Network / config failure → treat as unauthenticated; caller redirects.
    user = null;
  }
  return { response, user };
};
