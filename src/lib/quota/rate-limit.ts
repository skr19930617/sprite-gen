import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Lightweight per-user rate limiter backed by the `generations` audit table:
 * we count rows with the supplied marker via a synthetic table is heavy,
 * so we use an in-memory ring buffer per process (good enough for MVP and
 * Vercel's per-region instance pinning). For multi-region deployments,
 * swap with Upstash KV (kept as TODO).
 */

type Bucket = { tokens: number[]; max: number; windowMs: number };

const buckets = new Map<string, Bucket>();

export type RateLimitOptions = {
  /** Unique limiter key (e.g. `llm-parse:${userId}`). */
  key: string;
  /** Max calls allowed per window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
};

export const consumeToken = (opts: RateLimitOptions): RateLimitResult => {
  const now = Date.now();
  const existing = buckets.get(opts.key);
  const bucket: Bucket = existing ?? {
    tokens: [],
    max: opts.max,
    windowMs: opts.windowMs,
  };
  // Drop stale entries.
  bucket.tokens = bucket.tokens.filter((t) => now - t < bucket.windowMs);
  if (bucket.tokens.length >= bucket.max) {
    const oldest = bucket.tokens[0] ?? now;
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: bucket.windowMs - (now - oldest),
    };
  }
  bucket.tokens.push(now);
  buckets.set(opts.key, bucket);
  return {
    allowed: true,
    remaining: bucket.max - bucket.tokens.length,
    retryAfterMs: 0,
  };
};

/** Test-only: clear buckets between tests. */
export const __resetRateLimitForTests = (): void => {
  buckets.clear();
};

/** Optional Postgres-backed reservation (used as an audit trail when needed). */
export const recordCallForAudit = async (
  supabase: SupabaseClient,
  userId: string,
  kind: string,
): Promise<void> => {
  // No dedicated table in MVP — skipping. Helper kept as an injection point.
  void supabase;
  void userId;
  void kind;
};
