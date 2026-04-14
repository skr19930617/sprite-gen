'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  projectId: string;
  gifUrl: string | null;
  spritesheetUrl: string | null;
  regenerateDisabled: boolean;
};

export default function ProjectActions({
  projectId,
  gifUrl,
  spritesheetUrl,
  regenerateDisabled,
}: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onRegenerate = () => {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/projects/${projectId}/open-in-editor`, {
        method: 'POST',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? `編集オープンに失敗しました (${res.status})`);
        return;
      }
      router.push(json.next ?? `/drafts/${json.draft_id}/mask`);
    });
  };

  return (
    <section style={{ display: 'grid', gap: 12, marginTop: 16 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          onClick={onRegenerate}
          disabled={pending || regenerateDisabled}
          title={
            regenerateDisabled
              ? '互換性のないレンダラバージョンのため再生成できません'
              : ''
          }
          style={{ padding: 10 }}
        >
          {pending ? '読み込み中…' : 'Regenerate / Edit'}
        </button>
        {gifUrl ? (
          <a href={gifUrl} download="result.gif">
            GIF ダウンロード
          </a>
        ) : null}
        {spritesheetUrl ? (
          <a href={spritesheetUrl} download="spritesheet.png">
            スプライトシート ダウンロード
          </a>
        ) : null}
      </div>
      {error ? (
        <p role="alert" style={{ color: '#b00' }}>
          {error}
        </p>
      ) : null}
    </section>
  );
}
