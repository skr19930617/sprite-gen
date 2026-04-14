import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/require-user';
import { createAdminClient } from '@/lib/supabase/admin';
import { parsePrompt } from '@/server/llm/parse-prompt';
import {
  InvalidLlmResponseError,
  LlmTimeoutError,
  LlmUpstreamError,
} from '@/server/llm/errors';
import { STORAGE_BUCKET } from '@/server/storage/paths';
import { consumeToken } from '@/lib/quota/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 30;

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW = 60_000;

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const limit = consumeToken({
    key: `llm-parse:${user.id}`,
    max: RATE_LIMIT_MAX,
    windowMs: RATE_LIMIT_WINDOW,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'rate limit exceeded' },
      {
        status: 429,
        headers: {
          'retry-after': String(Math.ceil(limit.retryAfterMs / 1000)),
        },
      },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    draft_id?: string;
    prompt?: string;
  } | null;
  const draftId = body?.draft_id;
  const overridePrompt = body?.prompt;
  if (!draftId) {
    return NextResponse.json({ error: 'draft_id required' }, { status: 400 });
  }

  const draftRes = await supabase
    .from('drafts')
    .select(
      'id, prompt, source_path, llm_result, final_animation_type, final_params',
    )
    .eq('id', draftId)
    .single();
  if (draftRes.error || !draftRes.data) {
    return NextResponse.json({ error: 'draft not found' }, { status: 404 });
  }
  const draft = draftRes.data;
  const promptToUse = (overridePrompt ?? draft.prompt ?? '').trim();
  if (!promptToUse) {
    return NextResponse.json({ error: 'empty prompt' }, { status: 400 });
  }

  // Load source image bytes (optional but helps the LLM ground its answer).
  const admin = createAdminClient();
  let sourceBase64: string | null = null;
  if (draft.source_path) {
    const dl = await admin.storage
      .from(STORAGE_BUCKET)
      .download(draft.source_path);
    if (dl.data) {
      const buf = Buffer.from(await dl.data.arrayBuffer());
      sourceBase64 = buf.toString('base64');
    }
  }

  let llmResult;
  try {
    llmResult = await parsePrompt(promptToUse, {
      sourceImageBase64: sourceBase64,
    });
  } catch (err) {
    if (err instanceof InvalidLlmResponseError) {
      return NextResponse.json(
        { error: 'invalid LLM response', code: 'invalid_llm_response' },
        { status: 422 },
      );
    }
    if (err instanceof LlmTimeoutError) {
      return NextResponse.json(
        { error: 'llm timeout', code: 'llm_timeout' },
        { status: 504 },
      );
    }
    if (err instanceof LlmUpstreamError) {
      return NextResponse.json(
        { error: 'llm upstream error', code: 'llm_upstream_error' },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: 'unknown llm error', code: 'unknown' },
      { status: 500 },
    );
  }

  const update = await supabase
    .from('drafts')
    .update({
      llm_result: llmResult,
      final_animation_type: llmResult.animation_type,
      final_params: llmResult.params,
      // If the user passed a new prompt, persist it for reproducibility.
      ...(overridePrompt ? { prompt: promptToUse } : {}),
    })
    .eq('id', draftId);
  if (update.error) {
    return NextResponse.json(
      { error: 'failed to update draft', detail: update.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ draft_id: draftId, llm_result: llmResult });
}
