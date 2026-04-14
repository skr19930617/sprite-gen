import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { STORAGE_BUCKET } from '@/server/storage/paths';
import GeneratePanel from './GeneratePanel';

type DraftRow = {
  id: string;
  prompt: string;
  source_path: string;
  mask_path: string | null;
  gif_path: string | null;
  spritesheet_path: string | null;
  originating_project_id: string | null;
};

export default async function DraftPreviewPage({
  params,
}: {
  params: Promise<{ draft_id: string }>;
}) {
  const { draft_id } = await params;
  const supabase = await createClient();
  const draftRes = await supabase
    .from('drafts')
    .select(
      'id, prompt, source_path, mask_path, gif_path, spritesheet_path, originating_project_id',
    )
    .eq('id', draft_id)
    .single<DraftRow>();
  if (draftRes.error || !draftRes.data) {
    redirect('/upload?error=draft_not_found');
  }
  const draft = draftRes.data!;

  const admin = createAdminClient();
  const [gifSigned, sheetSigned] = await Promise.all([
    draft.gif_path
      ? admin.storage.from(STORAGE_BUCKET).createSignedUrl(draft.gif_path, 3600)
      : Promise.resolve({ data: null, error: null }),
    draft.spritesheet_path
      ? admin.storage
          .from(STORAGE_BUCKET)
          .createSignedUrl(draft.spritesheet_path, 3600)
      : Promise.resolve({ data: null, error: null }),
  ]);

  return (
    <main style={{ maxWidth: 720, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>プレビュー</h1>
      <p>プロンプト: {draft.prompt}</p>
      <GeneratePanel
        draftId={draft.id}
        gifUrl={gifSigned.data?.signedUrl ?? null}
        spritesheetUrl={sheetSigned.data?.signedUrl ?? null}
        originatingProjectId={draft.originating_project_id}
      />
    </main>
  );
}
