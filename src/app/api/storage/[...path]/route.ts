import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/require-user';
import { createAdminClient } from '@/lib/supabase/admin';
import { STORAGE_BUCKET } from '@/server/storage/paths';

export const runtime = 'nodejs';

/**
 * Authenticated, no-store proxy in front of Supabase Storage signed URLs.
 *
 * - Verifies the requested path's first segment matches the caller's user_id
 *   (defence-in-depth on top of bucket RLS).
 * - Streams the object back with `Cache-Control: private, no-store` so signed
 *   URLs are never cached by intermediate proxies / browsers.
 *
 * Use this instead of handing out raw signed URLs whenever the caller is
 * already authenticated and the artifact is small (gif / png / json).
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;
  const { path } = await ctx.params;
  if (!path || path.length === 0) {
    return NextResponse.json({ error: 'path required' }, { status: 400 });
  }
  const objectPath = path.join('/');
  const owner = path[0];
  if (owner !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const admin = createAdminClient();
  const dl = await admin.storage.from(STORAGE_BUCKET).download(objectPath);
  if (dl.error || !dl.data) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const buf = Buffer.from(await dl.data.arrayBuffer());
  const contentType = objectPath.endsWith('.gif')
    ? 'image/gif'
    : objectPath.endsWith('.png')
      ? 'image/png'
      : objectPath.endsWith('.json')
        ? 'application/json'
        : 'application/octet-stream';
  return new Response(buf, {
    status: 200,
    headers: {
      'content-type': contentType,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
