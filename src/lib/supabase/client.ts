import { createBrowserClient } from '@supabase/ssr';
import { clientEnv } from '@/lib/env-client';

/**
 * Browser-side Supabase client. Anon key only — never embed service-role.
 */
export const createClient = () =>
  createBrowserClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
