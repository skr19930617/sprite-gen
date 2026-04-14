// Supabase Edge Function: cleanup-drafts
//
// Deletes `drafts` rows (and their Storage artifacts) older than 24h.
// Schedule via Supabase dashboard:
//   "0 * * * *" (hourly) is fine; the function is idempotent.
//
// Deploy:
//   supabase functions deploy cleanup-drafts --no-verify-jwt
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
//
// Trigger:
//   curl -X POST https://<project>.supabase.co/functions/v1/cleanup-drafts \
//     -H "Authorization: Bearer <service-role-key>"

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const STORAGE_BUCKET = 'projects';
const MAX_AGE_HOURS = 24;
const BATCH_SIZE = 200;

type DraftRow = {
  id: string;
  user_id: string;
};

const draftDir = (userId: string, draftId: string): string =>
  `${userId}/drafts/${draftId}`;

const ARTIFACT_NAMES = [
  'source.png',
  'mask.png',
  'result.gif',
  'spritesheet.png',
  'project.json',
] as const;

Deno.serve(async (req) => {
  // Require service-role bearer (no JWT verification on the function itself
  // because we deploy --no-verify-jwt for cron callers).
  const auth = req.headers.get('authorization') ?? '';
  const expected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!expected || auth !== `Bearer ${expected}`) {
    return new Response('unauthorized', { status: 401 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!supabaseUrl) {
    return new Response('missing SUPABASE_URL', { status: 500 });
  }
  const admin = createClient(supabaseUrl, expected, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const cutoff = new Date(
    Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000,
  ).toISOString();

  let deleted = 0;
  let storageRemoved = 0;
  let storageErrors = 0;

  // Page through stale drafts.
  // We delete the storage objects first, then the row, so a partial run
  // remains safe to retry.
  while (true) {
    const { data, error } = await admin
      .from('drafts')
      .select('id, user_id')
      .lt('updated_at', cutoff)
      .limit(BATCH_SIZE)
      .returns<DraftRow[]>();
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (!data || data.length === 0) break;

    for (const row of data) {
      const paths = ARTIFACT_NAMES.map(
        (name) => `${draftDir(row.user_id, row.id)}/${name}`,
      );
      const remove = await admin.storage.from(STORAGE_BUCKET).remove(paths);
      if (remove.error) {
        storageErrors++;
      } else {
        storageRemoved += remove.data?.length ?? 0;
      }
    }

    const ids = data.map((d) => d.id);
    const del = await admin.from('drafts').delete().in('id', ids);
    if (del.error) {
      return new Response(JSON.stringify({ error: del.error.message }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
    deleted += ids.length;
    if (data.length < BATCH_SIZE) break;
  }

  return new Response(
    JSON.stringify({
      ok: true,
      deleted,
      storageRemoved,
      storageErrors,
      cutoff,
    }),
    { headers: { 'content-type': 'application/json' } },
  );
});
