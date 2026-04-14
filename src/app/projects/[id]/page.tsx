import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { STORAGE_BUCKET } from '@/server/storage/paths';
import { RENDERER_VERSION } from '@/server/renderer/types';
import ProjectActions from './ProjectActions';

type ProjectRow = {
  id: string;
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

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const projectRes = await supabase
    .from('projects')
    .select(
      'id, prompt, final_animation_type, source_path, mask_path, gif_path, spritesheet_path, project_json_path, renderer_version, created_at, updated_at',
    )
    .eq('id', id)
    .single<ProjectRow>();
  if (projectRes.error || !projectRes.data) {
    redirect('/projects');
  }
  const project = projectRes.data!;

  const admin = createAdminClient();
  const [gif, sheet] = await Promise.all([
    project.gif_path
      ? admin.storage
          .from(STORAGE_BUCKET)
          .createSignedUrl(project.gif_path, 3600)
      : Promise.resolve({ data: null }),
    project.spritesheet_path
      ? admin.storage
          .from(STORAGE_BUCKET)
          .createSignedUrl(project.spritesheet_path, 3600)
      : Promise.resolve({ data: null }),
  ]);

  const versionMismatch = project.renderer_version !== RENDERER_VERSION;

  return (
    <main style={{ maxWidth: 720, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>プロジェクト詳細</h1>
      <p>プロンプト: {project.prompt}</p>
      <p>
        animation_type: {project.final_animation_type} · renderer_version:{' '}
        {project.renderer_version}
      </p>
      {versionMismatch ? (
        <p role="alert" style={{ color: '#a60' }}>
          ⚠ このプロジェクトは互換性のないレンダラバージョンで作成されました —
          読み取り専用です
        </p>
      ) : null}
      {gif.data?.signedUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={gif.data.signedUrl}
          alt="result GIF"
          style={{ imageRendering: 'pixelated', maxWidth: 512 }}
        />
      ) : null}
      {sheet.data?.signedUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={sheet.data.signedUrl}
          alt="spritesheet"
          style={{ imageRendering: 'pixelated', maxWidth: 512 }}
        />
      ) : null}
      <ProjectActions
        projectId={project.id}
        gifUrl={gif.data?.signedUrl ?? null}
        spritesheetUrl={sheet.data?.signedUrl ?? null}
        regenerateDisabled={versionMismatch}
      />
    </main>
  );
}
