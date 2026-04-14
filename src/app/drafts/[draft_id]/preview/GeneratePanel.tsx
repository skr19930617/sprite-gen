'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  draftId: string;
  gifUrl: string | null;
  spritesheetUrl: string | null;
  originatingProjectId: string | null;
};

export default function GeneratePanel({
  draftId,
  gifUrl,
  spritesheetUrl,
  originatingProjectId,
}: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [currentGif, setCurrentGif] = useState<string | null>(gifUrl);
  const [currentSheet, setCurrentSheet] = useState<string | null>(
    spritesheetUrl,
  );

  const onGenerate = () => {
    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draft_id: draftId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? `生成に失敗しました (${res.status})`);
        return;
      }
      // Reload to fetch fresh signed URLs.
      router.refresh();
      // Hard refresh by reload to pick up new signed URLs:
      window.location.reload();
      setCurrentGif(currentGif);
      setCurrentSheet(currentSheet);
    });
  };

  const onSave = (mode: 'new' | 'overwrite' | 'duplicate') => {
    setError(null);
    startTransition(async () => {
      const payload: Record<string, string> =
        mode === 'new'
          ? { mode, draft_id: draftId }
          : mode === 'overwrite'
            ? {
                mode,
                project_id: originatingProjectId ?? '',
                draft_id: draftId,
              }
            : { mode, project_id: originatingProjectId ?? '' };
      const res = await fetch('/api/projects/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? `保存に失敗しました (${res.status})`);
        return;
      }
      router.push(`/projects/${json.project_id}`);
    });
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <button onClick={onGenerate} disabled={pending} style={{ padding: 12 }}>
        {pending ? '生成中…' : '生成 / 再生成'}
      </button>
      {error ? (
        <p role="alert" style={{ color: '#b00' }}>
          {error}
        </p>
      ) : null}
      {currentGif ? (
        <section>
          <h2>GIF</h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentGif}
            alt="生成 GIF"
            style={{ imageRendering: 'pixelated', maxWidth: 512 }}
          />
        </section>
      ) : (
        <p>まだ生成されていません。</p>
      )}
      {currentSheet ? (
        <section>
          <h2>スプライトシート</h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentSheet}
            alt="spritesheet"
            style={{ imageRendering: 'pixelated', maxWidth: 512 }}
          />
        </section>
      ) : null}
      <section>
        <h2>保存</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => onSave('new')} disabled={pending}>
            新規保存
          </button>
          {originatingProjectId ? (
            <>
              <button onClick={() => onSave('overwrite')} disabled={pending}>
                上書き保存
              </button>
              <button onClick={() => onSave('duplicate')} disabled={pending}>
                複製保存
              </button>
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}
