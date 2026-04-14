import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/require-user';
import { createAdminClient } from '@/lib/supabase/admin';
import { isPlan, PLAN_LIMITS } from '@/lib/quota/limits';
import { countSavedProjects, isOverSaveCap } from '@/lib/quota/usage';
import { STORAGE_BUCKET, draftPath, projectPath } from '@/server/storage/paths';
import { serializeProjectJson } from '@/server/projects/serialize';
import {
  animationParamsSchema,
  animationTypeSchema,
  llmAnimationSpecSchema,
} from '@/server/llm/schema';
import { RENDERER_VERSION } from '@/server/renderer/types';

export const runtime = 'nodejs';

const bodySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('new'), draft_id: z.string().uuid() }),
  z.object({
    mode: z.literal('overwrite'),
    project_id: z.string().uuid(),
    draft_id: z.string().uuid().optional(),
  }),
  z.object({ mode: z.literal('duplicate'), project_id: z.string().uuid() }),
]);

const ARTIFACTS = [
  'source.png',
  'mask.png',
  'result.gif',
  'spritesheet.png',
] as const;

type DraftRow = {
  id: string;
  user_id: string;
  prompt: string;
  llm_result: unknown;
  final_animation_type: string | null;
  final_params: unknown;
  created_at: string;
};

type ProjectRow = {
  id: string;
  user_id: string;
  prompt: string;
  final_animation_type: string;
  source_path: string;
  mask_path: string;
  gif_path: string | null;
  spritesheet_path: string | null;
  project_json_path: string;
  renderer_version: number;
  created_at: string;
  updated_at: string;
};

const copyArtifacts = async (
  admin: ReturnType<typeof createAdminClient>,
  fromDir: (artifact: (typeof ARTIFACTS)[number]) => string,
  toDir: (artifact: (typeof ARTIFACTS)[number]) => string,
  remove: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  for (const artifact of ARTIFACTS) {
    const src = fromDir(artifact);
    const dst = toDir(artifact);
    const op = remove
      ? await admin.storage.from(STORAGE_BUCKET).move(src, dst)
      : await admin.storage.from(STORAGE_BUCKET).copy(src, dst);
    if (op.error) {
      return { ok: false, error: `${artifact}: ${op.error.message}` };
    }
  }
  return { ok: true };
};

const writeProjectJson = async (
  admin: ReturnType<typeof createAdminClient>,
  draft: DraftRow,
  projectId: string,
  userId: string,
  createdAt: string,
  updatedAt: string,
): Promise<{ ok: true; bytes: Buffer } | { ok: false; error: string }> => {
  let bytes: Buffer;
  try {
    bytes = serializeProjectJson({
      scope: 'final',
      draft,
      project: {
        id: projectId,
        user_id: userId,
        created_at: createdAt,
        updated_at: updatedAt,
      },
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'serialize failed',
    };
  }
  const dst = projectPath(userId, projectId, 'project.json');
  const upload = await admin.storage.from(STORAGE_BUCKET).upload(dst, bytes, {
    contentType: 'application/json',
    upsert: true,
  });
  if (upload.error) return { ok: false, error: upload.error.message };
  return { ok: true, bytes };
};

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
  const body = parsed.data;
  const admin = createAdminClient();

  // Save quota check (skip for 'overwrite').
  if (body.mode === 'new' || body.mode === 'duplicate') {
    const profileRes = await supabase
      .from('profiles')
      .select('plan')
      .eq('id', user.id)
      .single<{ plan: string }>();
    const plan = isPlan(profileRes.data?.plan ?? 'free')
      ? (profileRes.data?.plan as 'free' | 'paid')
      : 'free';
    const used = await countSavedProjects(supabase, user.id);
    if (isOverSaveCap(used, plan)) {
      return NextResponse.json(
        {
          error: 'saved-project quota exceeded',
          code: 'save_quota_exceeded',
          plan,
          cap: PLAN_LIMITS[plan].savedProjects,
          used,
          upgradeUrl: '/billing',
        },
        { status: 402 },
      );
    }
  }

  if (body.mode === 'new') {
    const draftRes = await supabase
      .from('drafts')
      .select(
        'id, user_id, prompt, llm_result, final_animation_type, final_params, created_at',
      )
      .eq('id', body.draft_id)
      .single<DraftRow>();
    if (draftRes.error || !draftRes.data) {
      return NextResponse.json({ error: 'draft not found' }, { status: 404 });
    }
    const draft = draftRes.data;

    // Pre-allocate project id to use in storage paths.
    const newProjectId = crypto.randomUUID();
    const moved = await copyArtifacts(
      admin,
      (a) => draftPath(user.id, draft.id, a),
      (a) => projectPath(user.id, newProjectId, a),
      true,
    );
    if (!moved.ok) {
      return NextResponse.json(
        { error: 'storage move failed', detail: moved.error },
        { status: 500 },
      );
    }
    const now = new Date().toISOString();
    const written = await writeProjectJson(
      admin,
      draft,
      newProjectId,
      user.id,
      now,
      now,
    );
    if (!written.ok) {
      return NextResponse.json(
        { error: 'project.json write failed', detail: written.error },
        { status: 500 },
      );
    }
    const insertRes = await supabase.from('projects').insert({
      id: newProjectId,
      user_id: user.id,
      prompt: draft.prompt,
      final_animation_type: animationTypeSchema.parse(
        draft.final_animation_type,
      ),
      renderer_version: RENDERER_VERSION,
      source_path: projectPath(user.id, newProjectId, 'source.png'),
      mask_path: projectPath(user.id, newProjectId, 'mask.png'),
      project_json_path: projectPath(user.id, newProjectId, 'project.json'),
      gif_path: projectPath(user.id, newProjectId, 'result.gif'),
      spritesheet_path: projectPath(user.id, newProjectId, 'spritesheet.png'),
    });
    if (insertRes.error) {
      return NextResponse.json(
        { error: 'project insert failed', detail: insertRes.error.message },
        { status: 500 },
      );
    }
    await supabase.from('drafts').delete().eq('id', draft.id);
    return NextResponse.json({ ok: true, project_id: newProjectId });
  }

  if (body.mode === 'overwrite') {
    const projectRes = await supabase
      .from('projects')
      .select(
        'id, user_id, prompt, final_animation_type, source_path, mask_path, gif_path, spritesheet_path, project_json_path, renderer_version, created_at, updated_at',
      )
      .eq('id', body.project_id)
      .single<ProjectRow>();
    if (projectRes.error || !projectRes.data) {
      return NextResponse.json({ error: 'project not found' }, { status: 404 });
    }
    const project = projectRes.data;

    let draft: DraftRow | null = null;
    if (body.draft_id) {
      const dr = await supabase
        .from('drafts')
        .select(
          'id, user_id, prompt, llm_result, final_animation_type, final_params, created_at',
        )
        .eq('id', body.draft_id)
        .single<DraftRow>();
      if (dr.error || !dr.data) {
        return NextResponse.json(
          { error: 'draft not found for overwrite' },
          { status: 404 },
        );
      }
      draft = dr.data;
      // Replace artifacts in place from the draft's storage path.
      const moved = await copyArtifacts(
        admin,
        (a) => draftPath(user.id, draft!.id, a),
        (a) => projectPath(user.id, project.id, a),
        true,
      );
      if (!moved.ok) {
        return NextResponse.json(
          { error: 'storage move failed', detail: moved.error },
          { status: 500 },
        );
      }
    }

    const now = new Date().toISOString();
    const draftForJson: DraftRow = draft ?? {
      id: project.id,
      user_id: project.user_id,
      prompt: project.prompt,
      llm_result: null,
      final_animation_type: project.final_animation_type,
      final_params: null,
      created_at: project.created_at,
    };
    // For overwrite without a draft we still need a valid llm_result; load the
    // existing project.json to seed the serializer.
    if (!draft) {
      const existing = await admin.storage
        .from(STORAGE_BUCKET)
        .download(project.project_json_path);
      if (existing.data) {
        try {
          const json = JSON.parse(await existing.data.text()) as {
            llm_result?: unknown;
            final_animation_type?: string;
            final_params?: unknown;
          };
          draftForJson.llm_result = json.llm_result;
          if (
            typeof json.final_animation_type === 'string' &&
            animationTypeSchema.safeParse(json.final_animation_type).success
          ) {
            draftForJson.final_animation_type = json.final_animation_type;
          }
          if (animationParamsSchema.safeParse(json.final_params).success) {
            draftForJson.final_params = json.final_params;
          }
        } catch {
          // fall through — schema validation in serializer will reject
        }
      }
    }
    if (!llmAnimationSpecSchema.safeParse(draftForJson.llm_result).success) {
      return NextResponse.json(
        { error: 'cannot overwrite: missing valid llm_result' },
        { status: 422 },
      );
    }

    const written = await writeProjectJson(
      admin,
      draftForJson,
      project.id,
      user.id,
      project.created_at,
      now,
    );
    if (!written.ok) {
      return NextResponse.json(
        { error: 'project.json write failed', detail: written.error },
        { status: 500 },
      );
    }
    const updateRes = await supabase
      .from('projects')
      .update({ updated_at: now })
      .eq('id', project.id);
    if (updateRes.error) {
      return NextResponse.json(
        { error: 'project update failed', detail: updateRes.error.message },
        { status: 500 },
      );
    }
    if (draft) {
      await supabase.from('drafts').delete().eq('id', draft.id);
    }
    return NextResponse.json({ ok: true, project_id: project.id });
  }

  // duplicate
  const projectRes = await supabase
    .from('projects')
    .select(
      'id, user_id, prompt, final_animation_type, source_path, mask_path, gif_path, spritesheet_path, project_json_path, renderer_version, created_at, updated_at',
    )
    .eq('id', body.project_id)
    .single<ProjectRow>();
  if (projectRes.error || !projectRes.data) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }
  const source = projectRes.data;
  const newProjectId = crypto.randomUUID();
  const copied = await copyArtifacts(
    admin,
    (a) => projectPath(user.id, source.id, a),
    (a) => projectPath(user.id, newProjectId, a),
    false,
  );
  if (!copied.ok) {
    return NextResponse.json(
      { error: 'storage copy failed', detail: copied.error },
      { status: 500 },
    );
  }
  // Read source project.json for llm_result / final_*.
  const dl = await admin.storage
    .from(STORAGE_BUCKET)
    .download(source.project_json_path);
  if (!dl.data) {
    return NextResponse.json(
      { error: 'failed to read source project.json' },
      { status: 500 },
    );
  }
  let parsedSource: {
    llm_result: unknown;
    final_animation_type: string;
    final_params: unknown;
  };
  try {
    parsedSource = JSON.parse(await dl.data.text());
  } catch {
    return NextResponse.json(
      { error: 'source project.json is invalid JSON' },
      { status: 500 },
    );
  }
  const draftForJson: DraftRow = {
    id: newProjectId,
    user_id: user.id,
    prompt: source.prompt,
    llm_result: parsedSource.llm_result,
    final_animation_type:
      parsedSource.final_animation_type ?? source.final_animation_type,
    final_params: parsedSource.final_params,
    created_at: new Date().toISOString(),
  };
  const now = new Date().toISOString();
  const written = await writeProjectJson(
    admin,
    draftForJson,
    newProjectId,
    user.id,
    now,
    now,
  );
  if (!written.ok) {
    return NextResponse.json(
      { error: 'project.json write failed', detail: written.error },
      { status: 500 },
    );
  }
  const insertRes = await supabase.from('projects').insert({
    id: newProjectId,
    user_id: user.id,
    prompt: source.prompt,
    final_animation_type: animationTypeSchema.parse(
      draftForJson.final_animation_type,
    ),
    renderer_version: RENDERER_VERSION,
    source_path: projectPath(user.id, newProjectId, 'source.png'),
    mask_path: projectPath(user.id, newProjectId, 'mask.png'),
    project_json_path: projectPath(user.id, newProjectId, 'project.json'),
    gif_path: projectPath(user.id, newProjectId, 'result.gif'),
    spritesheet_path: projectPath(user.id, newProjectId, 'spritesheet.png'),
  });
  if (insertRes.error) {
    return NextResponse.json(
      { error: 'project insert failed', detail: insertRes.error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, project_id: newProjectId });
}
