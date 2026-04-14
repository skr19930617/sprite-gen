import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/require-user';
import { createAdminClient } from '@/lib/supabase/admin';
import { validatePngBuffer } from '@/server/image/png-validate-server';
import { parsePrompt } from '@/server/llm/parse-prompt';
import {
  InvalidLlmResponseError,
  LlmTimeoutError,
  LlmUpstreamError,
} from '@/server/llm/errors';
import { STORAGE_BUCKET, draftPath } from '@/server/storage/paths';

export const runtime = 'nodejs';
export const maxDuration = 30;

const PROMPT_MAX = 500;

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.startsWith('multipart/form-data')) {
    return NextResponse.json(
      { error: 'expected multipart/form-data' },
      { status: 415 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'invalid form data' }, { status: 400 });
  }

  const file = form.get('file');
  const prompt = form.get('prompt');
  if (!(file instanceof File) || typeof prompt !== 'string') {
    return NextResponse.json(
      { error: 'file and prompt are required' },
      { status: 400 },
    );
  }
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    return NextResponse.json({ error: 'prompt is empty' }, { status: 400 });
  }
  if (trimmedPrompt.length > PROMPT_MAX) {
    return NextResponse.json(
      { error: `prompt exceeds ${PROMPT_MAX} chars` },
      { status: 400 },
    );
  }
  if (file.type && file.type !== 'image/png') {
    return NextResponse.json(
      { error: 'image/png required', code: 'not_png' },
      { status: 415 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const validated = await validatePngBuffer(buffer);
  if (!validated.ok) {
    return NextResponse.json(
      { error: validated.message, code: validated.code },
      { status: 400 },
    );
  }

  // 1) Insert draft row first (so we have a draft_id to scope the storage path).
  const insert = await auth.supabase
    .from('drafts')
    .insert({
      user_id: user.id,
      prompt: trimmedPrompt,
      source_path: '',
    })
    .select('id, created_at')
    .single();
  if (insert.error || !insert.data) {
    return NextResponse.json(
      { error: 'failed to create draft', detail: insert.error?.message },
      { status: 500 },
    );
  }
  const draftId = insert.data.id as string;
  const sourcePath = draftPath(user.id, draftId, 'source.png');

  // 2) Upload source.png to Storage.
  const admin = createAdminClient();
  const upload = await admin.storage
    .from(STORAGE_BUCKET)
    .upload(sourcePath, buffer, {
      contentType: 'image/png',
      upsert: false,
    });
  if (upload.error) {
    await auth.supabase.from('drafts').delete().eq('id', draftId);
    return NextResponse.json(
      { error: 'storage upload failed', detail: upload.error.message },
      { status: 500 },
    );
  }

  const rollback = async (): Promise<void> => {
    await admin.storage.from(STORAGE_BUCKET).remove([sourcePath]);
    await auth.supabase.from('drafts').delete().eq('id', draftId);
  };

  // 3) Synchronous LLM parse (10s timeout). Failure -> rollback + 422/504/502.
  const sourceBase64 = buffer.toString('base64');
  let llmResult;
  try {
    llmResult = await parsePrompt(trimmedPrompt, {
      sourceImageBase64: sourceBase64,
    });
  } catch (err) {
    await rollback();
    if (err instanceof InvalidLlmResponseError) {
      return NextResponse.json(
        {
          error:
            'プロンプトを解析できませんでした。表現を変えて再アップロードしてください',
          code: 'invalid_llm_response',
        },
        { status: 422 },
      );
    }
    if (err instanceof LlmTimeoutError) {
      return NextResponse.json(
        { error: 'LLM 応答がタイムアウトしました', code: 'llm_timeout' },
        { status: 504 },
      );
    }
    if (err instanceof LlmUpstreamError) {
      return NextResponse.json(
        { error: 'LLM 呼び出しに失敗しました', code: 'llm_upstream_error' },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: 'unexpected LLM error', code: 'unknown' },
      { status: 500 },
    );
  }

  // 4) Persist source_path + LLM result + final_* on the draft.
  const update = await auth.supabase
    .from('drafts')
    .update({
      source_path: sourcePath,
      llm_result: llmResult,
      final_animation_type: llmResult.animation_type,
      final_params: llmResult.params,
    })
    .eq('id', draftId);
  if (update.error) {
    await rollback();
    return NextResponse.json(
      { error: 'failed to seed draft', detail: update.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    draft_id: draftId,
    next: `/drafts/${draftId}/mask`,
    llm_result: llmResult,
  });
}
