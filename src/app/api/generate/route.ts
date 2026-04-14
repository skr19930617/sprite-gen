import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/require-user';
import { createAdminClient } from '@/lib/supabase/admin';
import { STORAGE_BUCKET, draftPath } from '@/server/storage/paths';
import { render, RenderTimeoutError } from '@/server/renderer';
import { RENDERER_VERSION } from '@/server/renderer/types';
import {
  llmAnimationSpecSchema,
  animationParamsSchema,
  animationTypeSchema,
  type LlmAnimationSpec,
} from '@/server/llm/schema';
import { isPlan, PLAN_LIMITS } from '@/lib/quota/limits';
import {
  countSuccessGenerationsThisMonth,
  isOverGenerationCap,
} from '@/lib/quota/usage';
import { withUserLock } from '@/lib/quota/advisory-lock';
import { serializeProjectJson } from '@/server/projects/serialize';

export const runtime = 'nodejs';
export const maxDuration = 30;

type DraftRow = {
  id: string;
  user_id: string;
  prompt: string;
  source_path: string;
  mask_path: string | null;
  gif_path: string | null;
  spritesheet_path: string | null;
  project_json_path: string | null;
  llm_result: unknown;
  final_animation_type: string | null;
  final_params: unknown;
  originating_project_id: string | null;
  created_at: string;
};

type ProfileRow = { plan: string };

const insertGeneration = async (
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  draftId: string,
  status: 'success' | 'failed' | 'timeout',
  counted: boolean,
  errorCode?: string,
): Promise<void> => {
  await admin.from('generations').insert({
    user_id: userId,
    draft_id: draftId,
    status,
    counted,
    error_code: errorCode ?? null,
  });
};

const cleanupPartialDraftArtifacts = async (
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  draftId: string,
): Promise<void> => {
  await admin.storage
    .from(STORAGE_BUCKET)
    .remove([
      draftPath(userId, draftId, 'result.gif'),
      draftPath(userId, draftId, 'spritesheet.png'),
      draftPath(userId, draftId, 'project.json'),
    ]);
};

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const body = (await request.json().catch(() => null)) as {
    draft_id?: string;
  } | null;
  const draftId = body?.draft_id;
  if (!draftId) {
    return NextResponse.json({ error: 'draft_id required' }, { status: 400 });
  }

  const draftRes = await supabase
    .from('drafts')
    .select(
      'id, user_id, prompt, source_path, mask_path, gif_path, spritesheet_path, project_json_path, llm_result, final_animation_type, final_params, originating_project_id, created_at',
    )
    .eq('id', draftId)
    .single<DraftRow>();
  if (draftRes.error || !draftRes.data) {
    return NextResponse.json({ error: 'draft not found' }, { status: 404 });
  }
  const draft = draftRes.data;
  if (!draft.mask_path) {
    return NextResponse.json(
      { error: 'mask not yet saved for this draft' },
      { status: 400 },
    );
  }

  // Validate stored final_* / llm_result payloads.
  const llmParse = llmAnimationSpecSchema.safeParse(draft.llm_result);
  if (!llmParse.success) {
    return NextResponse.json(
      { error: 'draft has no valid LLM result; re-upload required' },
      { status: 422 },
    );
  }
  const llmResult: LlmAnimationSpec = llmParse.data;
  const finalAnimationType = animationTypeSchema.safeParse(
    draft.final_animation_type,
  ).success
    ? (draft.final_animation_type as LlmAnimationSpec['animation_type'])
    : llmResult.animation_type;
  const paramsParse = animationParamsSchema.safeParse(draft.final_params);
  const finalParams = paramsParse.success ? paramsParse.data : llmResult.params;

  // Determine plan.
  const profileRes = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', user.id)
    .single<ProfileRow>();
  const planRaw = profileRes.data?.plan ?? 'free';
  const plan = isPlan(planRaw) ? planRaw : 'free';

  const isRegeneration =
    draft.originating_project_id !== null || draft.gif_path !== null;

  // Quota check (only for first-time generations).
  if (!isRegeneration) {
    const used = await countSuccessGenerationsThisMonth(supabase, user.id);
    if (isOverGenerationCap(used, plan)) {
      return NextResponse.json(
        {
          error: 'monthly generation quota exceeded',
          code: 'quota_exceeded',
          plan,
          cap: PLAN_LIMITS[plan].generationsPerMonth,
          used,
          upgradeUrl: '/billing',
        },
        { status: 402 },
      );
    }
  }

  const admin = createAdminClient();
  // Download source + mask.
  const [srcDl, maskDl] = await Promise.all([
    admin.storage.from(STORAGE_BUCKET).download(draft.source_path),
    admin.storage.from(STORAGE_BUCKET).download(draft.mask_path),
  ]);
  if (srcDl.error || !srcDl.data || maskDl.error || !maskDl.data) {
    await insertGeneration(
      admin,
      user.id,
      draftId,
      'failed',
      false,
      'storage_download',
    );
    return NextResponse.json(
      { error: 'failed to download source/mask from Storage' },
      { status: 500 },
    );
  }
  const sourceBuffer = Buffer.from(await srcDl.data.arrayBuffer());
  const maskBuffer = Buffer.from(await maskDl.data.arrayBuffer());

  // Render with internal timeout.
  let result;
  try {
    result = await render({
      source: sourceBuffer,
      mask: maskBuffer,
      animation_type: finalAnimationType,
      params: finalParams,
      required_regions: llmResult.required_regions,
    });
  } catch (err) {
    if (err instanceof RenderTimeoutError) {
      await cleanupPartialDraftArtifacts(admin, user.id, draftId);
      await insertGeneration(
        admin,
        user.id,
        draftId,
        'timeout',
        false,
        'render_timeout',
      );
      return NextResponse.json(
        { error: 'rendering timed out', code: 'render_timeout' },
        { status: 504 },
      );
    }
    await cleanupPartialDraftArtifacts(admin, user.id, draftId);
    await insertGeneration(
      admin,
      user.id,
      draftId,
      'failed',
      false,
      'render_error',
    );
    return NextResponse.json(
      {
        error: 'render failed',
        detail: err instanceof Error ? err.message : 'unknown',
      },
      { status: 500 },
    );
  }

  // Upload artifacts to draft path.
  const gifPath = draftPath(user.id, draftId, 'result.gif');
  const sheetPath = draftPath(user.id, draftId, 'spritesheet.png');
  const jsonPath = draftPath(user.id, draftId, 'project.json');
  const projectJsonBytes = serializeProjectJson({
    scope: 'draft',
    draft: {
      id: draft.id,
      user_id: draft.user_id,
      prompt: draft.prompt,
      llm_result: llmResult,
      final_animation_type: finalAnimationType,
      final_params: finalParams,
      created_at: draft.created_at,
    },
  });

  const uploads = await Promise.all([
    admin.storage
      .from(STORAGE_BUCKET)
      .upload(gifPath, result.gif, { contentType: 'image/gif', upsert: true }),
    admin.storage.from(STORAGE_BUCKET).upload(sheetPath, result.spritesheet, {
      contentType: 'image/png',
      upsert: true,
    }),
    admin.storage.from(STORAGE_BUCKET).upload(jsonPath, projectJsonBytes, {
      contentType: 'application/json',
      upsert: true,
    }),
  ]);
  for (const u of uploads) {
    if (u.error) {
      await cleanupPartialDraftArtifacts(admin, user.id, draftId);
      await insertGeneration(
        admin,
        user.id,
        draftId,
        'failed',
        false,
        'storage_upload',
      );
      return NextResponse.json(
        { error: 'failed to upload artifacts', detail: u.error.message },
        { status: 500 },
      );
    }
  }

  // Update the draft row.
  const update = await supabase
    .from('drafts')
    .update({
      gif_path: gifPath,
      spritesheet_path: sheetPath,
      project_json_path: jsonPath,
      final_animation_type: finalAnimationType,
      final_params: finalParams,
    })
    .eq('id', draftId);
  if (update.error) {
    await cleanupPartialDraftArtifacts(admin, user.id, draftId);
    await insertGeneration(
      admin,
      user.id,
      draftId,
      'failed',
      false,
      'db_update',
    );
    return NextResponse.json(
      {
        error: 'failed to persist artifact paths',
        detail: update.error.message,
      },
      { status: 500 },
    );
  }

  // Success — record in generations (with advisory lock when first-time).
  if (!isRegeneration) {
    await withUserLock(supabase, user.id, async () => {
      await insertGeneration(admin, user.id, draftId, 'success', true);
    });
  } else {
    await insertGeneration(admin, user.id, draftId, 'success', false);
  }

  return NextResponse.json({
    draft_id: draftId,
    renderer_version: RENDERER_VERSION,
    fell_back_to_body_only: result.fellBackToBodyOnly,
    is_regeneration: isRegeneration,
  });
}
