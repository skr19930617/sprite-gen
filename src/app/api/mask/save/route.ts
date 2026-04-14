import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { requireUser } from '@/lib/auth/require-user';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  animationParamsSchema,
  animationTypeSchema,
} from '@/server/llm/schema';
import { STORAGE_BUCKET, draftPath } from '@/server/storage/paths';
import { z } from 'zod';

export const runtime = 'nodejs';

const bodySchema = z.object({
  draft_id: z.string().uuid(),
  /** Base64-encoded RGBA buffer (width*height*4 bytes) for the mask. */
  mask_png_base64: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  final_animation_type: animationTypeSchema,
  final_params: animationParamsSchema,
});

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid body', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { draft_id, mask_png_base64, final_animation_type, final_params } =
    parsed.data;

  // Verify ownership via RLS-aware select.
  const draftRow = await supabase
    .from('drafts')
    .select('id, source_path')
    .eq('id', draft_id)
    .single();
  if (draftRow.error || !draftRow.data) {
    return NextResponse.json({ error: 'draft not found' }, { status: 404 });
  }

  // Re-encode received bytes through sharp to ensure it's a valid PNG and
  // strip arbitrary metadata.
  let pngBytes: Buffer;
  try {
    const incoming = Buffer.from(mask_png_base64, 'base64');
    pngBytes = await sharp(incoming).png().toBuffer();
  } catch {
    return NextResponse.json({ error: 'invalid mask png' }, { status: 400 });
  }

  const maskStoragePath = draftPath(user.id, draft_id, 'mask.png');
  const admin = createAdminClient();
  const upload = await admin.storage
    .from(STORAGE_BUCKET)
    .upload(maskStoragePath, pngBytes, {
      contentType: 'image/png',
      upsert: true,
    });
  if (upload.error) {
    return NextResponse.json(
      { error: 'mask upload failed', detail: upload.error.message },
      { status: 500 },
    );
  }

  const update = await supabase
    .from('drafts')
    .update({
      mask_path: maskStoragePath,
      final_animation_type,
      final_params,
    })
    .eq('id', draft_id);
  if (update.error) {
    return NextResponse.json(
      { error: 'failed to update draft', detail: update.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, mask_path: maskStoragePath });
}
