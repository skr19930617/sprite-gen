import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

/**
 * Service-role client. ONLY for server-side trusted operations
 * (Stripe webhook, scheduled cleanup, advisory locks, generations insert).
 * Never instantiate in client code.
 */
export const createAdminClient = () =>
  createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
