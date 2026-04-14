/**
 * Centralized env access. Throws at startup if a required server-side var is
 * missing in production (validated lazily on first read so build-time SSG
 * still works without secrets).
 */

const required = (name: string, value: string | undefined): string => {
  if (!value || value.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
};

export const env = {
  // Public
  get NEXT_PUBLIC_SITE_URL(): string {
    return required('NEXT_PUBLIC_SITE_URL', process.env.NEXT_PUBLIC_SITE_URL);
  },
  get NEXT_PUBLIC_SUPABASE_URL(): string {
    return required(
      'NEXT_PUBLIC_SUPABASE_URL',
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    );
  },
  get NEXT_PUBLIC_SUPABASE_ANON_KEY(): string {
    return required(
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
  },
  // Server only (do NOT read from client code).
  get SUPABASE_SERVICE_ROLE_KEY(): string {
    return required(
      'SUPABASE_SERVICE_ROLE_KEY',
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
  },
  get ANTHROPIC_API_KEY(): string {
    return required('ANTHROPIC_API_KEY', process.env.ANTHROPIC_API_KEY);
  },
  get STRIPE_SECRET_KEY(): string {
    return required('STRIPE_SECRET_KEY', process.env.STRIPE_SECRET_KEY);
  },
  get STRIPE_WEBHOOK_SECRET(): string {
    return required('STRIPE_WEBHOOK_SECRET', process.env.STRIPE_WEBHOOK_SECRET);
  },
  get STRIPE_PRICE_ID_MONTHLY(): string {
    return required(
      'STRIPE_PRICE_ID_MONTHLY',
      process.env.STRIPE_PRICE_ID_MONTHLY,
    );
  },
} as const;
