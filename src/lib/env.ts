/**
 * Server-side env access. DO NOT import from 'use client' components —
 * use `@/lib/env-client` for NEXT_PUBLIC_* vars instead.
 *
 * Re-exports client env so server code can use a single import.
 */
import 'server-only';

import { clientEnv } from './env-client';

const LLM_BACKENDS = ['anthropic', 'claude_code_cli'] as const;
type LlmBackend = (typeof LLM_BACKENDS)[number];

const required = (name: string, value: string | undefined): string => {
  if (!value || value.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
};

const optional = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

export const env = {
  ...clientEnv,
  // Server only
  get LLM_BACKEND(): LlmBackend {
    const value = process.env.LLM_BACKEND?.trim() ?? 'anthropic';
    if ((LLM_BACKENDS as readonly string[]).includes(value)) {
      return value as LlmBackend;
    }
    throw new Error(
      `Invalid LLM_BACKEND: ${value}. Expected one of ${LLM_BACKENDS.join(', ')}`,
    );
  },
  get LLM_CLI_COMMAND(): string {
    return optional(process.env.LLM_CLI_COMMAND) ?? 'claude';
  },
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
