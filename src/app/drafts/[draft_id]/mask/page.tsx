import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { STORAGE_BUCKET } from '@/server/storage/paths';
import QuotaBadge from '@/components/QuotaBadge';
import { loadQuotaSummary } from '@/lib/quota/server-summary';
import MaskEditor from './MaskEditor';

type DraftRow = {
  id: string;
  prompt: string;
  source_path: string;
  llm_result: unknown;
  final_animation_type: string | null;
  final_params: unknown;
};

export default async function DraftMaskPage({
  params,
}: {
  params: Promise<{ draft_id: string }>;
}) {
  const { draft_id } = await params;
  const supabase = await createClient();
  const draftRes = await supabase
    .from('drafts')
    .select(
      'id, prompt, source_path, llm_result, final_animation_type, final_params',
    )
    .eq('id', draft_id)
    .single<DraftRow>();
  if (draftRes.error || !draftRes.data) {
    redirect('/upload?error=draft_not_found');
  }
  const draft = draftRes.data!;

  // Issue a 1-hour signed URL for the source image so the client can fetch it.
  const admin = createAdminClient();
  const signed = await admin.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(draft.source_path, 3600);
  if (signed.error || !signed.data) {
    redirect('/upload?error=storage_signed_url_failed');
  }

  const summary = await loadQuotaSummary();
  return (
    <main style={{ maxWidth: 960, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>マスク編集</h1>
      <QuotaBadge summary={summary} />
      <p>プロンプト: {draft.prompt}</p>
      <MaskEditor
        draftId={draft.id}
        sourceUrl={signed.data!.signedUrl}
        llmResult={draft.llm_result}
        initialAnimationType={draft.final_animation_type}
        initialParams={draft.final_params}
      />
    </main>
  );
}
