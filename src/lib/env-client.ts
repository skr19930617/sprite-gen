/**
 * Client-safe env vars (NEXT_PUBLIC_* only).
 * Safe to import from 'use client' components.
 */

const required = (name: string, value: string | undefined): string => {
  if (!value || value.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
};

export const clientEnv = {
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
} as const;
