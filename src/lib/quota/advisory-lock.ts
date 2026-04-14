import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Best-effort per-user advisory lock used to serialize quota count+insert
 * across concurrent /api/generate calls (only on first-time generations).
 *
 * Strategy: 64-bit Postgres advisory lock keyed on the user uuid.
 * Falls back to no-op when the RPC is unavailable (tests / local dev) so the
 * happy path still works — the race window stays very small.
 */

const hashUuidToBigInt = (uuid: string): string => {
  // Convert first 16 hex chars (64 bits) of the uuid (sans dashes) into a
  // signed bigint string. We accept some collisions across users since the
  // lock is per-user anyway.
  const hex = uuid.replace(/-/g, '').slice(0, 16);
  if (!/^[0-9a-fA-F]+$/.test(hex)) return '0';
  let big = BigInt('0x' + hex);
  // Postgres bigint is signed: shift into [-2^63, 2^63).
  const TWO_POW_63 = BigInt('9223372036854775808');
  if (big >= TWO_POW_63) big -= TWO_POW_63 * BigInt(2);
  return big.toString();
};

export const withUserLock = async <T>(
  supabase: SupabaseClient,
  userId: string,
  fn: () => Promise<T>,
): Promise<T> => {
  const key = hashUuidToBigInt(userId);
  // Try acquiring; ignore RPC failures (function may not exist).
  try {
    await supabase.rpc('pg_advisory_xact_lock', { key });
  } catch {
    // ignore — best effort
  }
  return await fn();
};
