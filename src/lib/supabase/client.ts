import { createBrowserClient } from '@supabase/ssr';
import { env } from '@/lib/env';

/**
 * Browser-side Supabase client. Anon key only — never embed service-role.
 */
export const createClient = () =>
  createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
