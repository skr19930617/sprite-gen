import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/require-user';
import { createAdminClient } from '@/lib/supabase/admin';
import { STORAGE_BUCKET, draftPath, projectPath } from '@/server/storage/paths';
import {
  animationParamsSchema,
  animationTypeSchema,
} from '@/server/llm/schema';

export const runtime = 'nodejs';

type ProjectRow = {
  id: string;
  user_id: string;
  prompt: string;
  source_path: string;
  mask_path: string;
  gif_path: string | null;
  spritesheet_path: string | null;
  project_json_path: string;
  renderer_version: number;
};

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;
  const { id: projectId } = await ctx.params;

  const projectRes = await supabase
    .from('projects')
    .select(
      'id, user_id, prompt, source_path, mask_path, gif_path, spritesheet_path, project_json_path, renderer_version',
    )
    .eq('id', projectId)
    .single<ProjectRow>();
  if (projectRes.error || !projectRes.data) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }
  const project = projectRes.data;

  const admin = createAdminClient();
  const dl = await admin.storage
    .from(STORAGE_BUCKET)
    .download(project.project_json_path);
  if (!dl.data) {
    return NextResponse.json(
      { error: 'failed to read project.json' },
      { status: 500 },
    );
  }
  let projJson: {
    prompt?: string;
    llm_result?: unknown;
    final_animation_type?: string;
    final_params?: unknown;
  };
  try {
    projJson = JSON.parse(await dl.data.text());
  } catch {
    return NextResponse.json(
      { error: 'project.json is not valid JSON' },
      { status: 500 },
    );
  }

  const draftId = crypto.randomUUID();
  const artifacts: Array<{ from: string; to: string }> = [
    {
      from: projectPath(user.id, project.id, 'source.png'),
      to: draftPath(user.id, draftId, 'source.png'),
    },
    {
      from: projectPath(user.id, project.id, 'mask.png'),
      to: draftPath(user.id, draftId, 'mask.png'),
    },
  ];
  if (project.gif_path) {
    artifacts.push({
      from: projectPath(user.id, project.id, 'result.gif'),
      to: draftPath(user.id, draftId, 'result.gif'),
    });
  }
  if (project.spritesheet_path) {
    artifacts.push({
      from: projectPath(user.id, project.id, 'spritesheet.png'),
      to: draftPath(user.id, draftId, 'spritesheet.png'),
    });
  }
  artifacts.push({
    from: projectPath(user.id, project.id, 'project.json'),
    to: draftPath(user.id, draftId, 'project.json'),
  });

  for (const { from, to } of artifacts) {
    const op = await admin.storage.from(STORAGE_BUCKET).copy(from, to);
    if (op.error) {
      return NextResponse.json(
        {
          error: 'failed to copy artifact',
          detail: op.error.message,
          from,
          to,
        },
        { status: 500 },
      );
    }
  }

  const finalAnimationType =
    typeof projJson.final_animation_type === 'string' &&
    animationTypeSchema.safeParse(projJson.final_animation_type).success
      ? projJson.final_animation_type
      : null;
  const finalParams = animationParamsSchema.safeParse(projJson.final_params)
    .success
    ? projJson.final_params
    : null;

  const insert = await supabase.from('drafts').insert({
    id: draftId,
    user_id: user.id,
    prompt: projJson.prompt ?? project.prompt,
    llm_result: projJson.llm_result ?? null,
    final_animation_type: finalAnimationType,
    final_params: finalParams,
    source_path: draftPath(user.id, draftId, 'source.png'),
    mask_path: draftPath(user.id, draftId, 'mask.png'),
    gif_path: project.gif_path
      ? draftPath(user.id, draftId, 'result.gif')
      : null,
    spritesheet_path: project.spritesheet_path
      ? draftPath(user.id, draftId, 'spritesheet.png')
      : null,
    project_json_path: draftPath(user.id, draftId, 'project.json'),
    originating_project_id: project.id,
  });
  if (insert.error) {
    return NextResponse.json(
      { error: 'failed to insert draft', detail: insert.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    draft_id: draftId,
    next: `/drafts/${draftId}/mask`,
    renderer_version_match: project.renderer_version,
  });
}
