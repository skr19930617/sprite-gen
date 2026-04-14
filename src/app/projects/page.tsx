import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { STORAGE_BUCKET } from '@/server/storage/paths';
import QuotaBadge from '@/components/QuotaBadge';
import { loadQuotaSummary } from '@/lib/quota/server-summary';

type ProjectRow = {
  id: string;
  prompt: string;
  final_animation_type: string;
  gif_path: string | null;
  updated_at: string;
};

export default async function ProjectsListPage() {
  const supabase = await createClient();
  const projectRes = await supabase
    .from('projects')
    .select('id, prompt, final_animation_type, gif_path, updated_at')
    .order('updated_at', { ascending: false })
    .limit(100);
  if (projectRes.error) {
    return (
      <p>プロジェクト一覧の取得に失敗しました: {projectRes.error.message}</p>
    );
  }

  const admin = createAdminClient();
  const rows = (projectRes.data ?? []) as ProjectRow[];
  const signed = await Promise.all(
    rows.map(async (p) =>
      p.gif_path
        ? ((
            await admin.storage
              .from(STORAGE_BUCKET)
              .createSignedUrl(p.gif_path, 3600)
          ).data?.signedUrl ?? null)
        : null,
    ),
  );

  const summary = await loadQuotaSummary();
  return (
    <main style={{ maxWidth: 960, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>保存済みプロジェクト</h1>
      <QuotaBadge summary={summary} />
      {rows.length === 0 ? (
        <p>
          まだプロジェクトがありません。<Link href="/upload">アップロード</Link>{' '}
          から始めましょう。
        </p>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 16,
          }}
        >
          {rows.map((p, i) => (
            <li
              key={p.id}
              style={{
                border: '1px solid #ccc',
                padding: 12,
                borderRadius: 6,
              }}
            >
              <Link href={`/projects/${p.id}`}>
                {signed[i] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={signed[i]!}
                    alt={p.prompt}
                    style={{
                      width: '100%',
                      imageRendering: 'pixelated',
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: '100%',
                      height: 120,
                      background: '#eee',
                    }}
                  />
                )}
                <p style={{ fontSize: 12, marginTop: 8 }}>
                  {p.prompt.slice(0, 60)}
                </p>
                <p style={{ fontSize: 11, color: '#888' }}>
                  {p.final_animation_type} ·{' '}
                  {new Date(p.updated_at).toLocaleString('ja-JP')}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
