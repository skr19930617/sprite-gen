'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { validatePngHeader } from '@/lib/image/png-validation';

const checkerStyle: React.CSSProperties = {
  background:
    'conic-gradient(#ddd 25%, #fff 0 50%, #ddd 0 75%, #fff 0) 0 0/16px 16px',
  display: 'block',
  imageRendering: 'pixelated',
  maxWidth: 512,
  maxHeight: 512,
};

export default function UploadPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const handleFile = async (f: File): Promise<void> => {
    setError(null);
    if (f.type !== 'image/png') {
      setError('透過 PNG が必要です（JPEG など他形式は使えません）');
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    const buf = new Uint8Array(await f.arrayBuffer());
    const res = validatePngHeader(buf);
    if (!res.ok) {
      setError(res.message);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    setFile(f);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!file) {
      setError('PNG ファイルを選択してください');
      return;
    }
    if (!prompt.trim()) {
      setError('プロンプトを入力してください');
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('prompt', prompt.trim());
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? `エラーが発生しました (${res.status})`);
        return;
      }
      router.push(json.next ?? `/drafts/${json.draft_id}/mask`);
    });
  };

  const submitDisabled = pending || !file || !prompt.trim();

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <p>透過 PNG（最大 512×512、2MB 以下）と動きの指示を入力してください。</p>
      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 16 }}>
        <label>
          PNG ファイル
          <input
            ref={inputRef}
            type="file"
            accept="image/png"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
        </label>
        {previewUrl ? (
          <figure style={{ margin: 0 }}>
            <div style={checkerStyle}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt="アップロード画像のプレビュー"
                style={{ display: 'block', maxWidth: 512, maxHeight: 512 }}
              />
            </div>
          </figure>
        ) : null}
        <label>
          動きの指示（例: 餌に近づいて口をぱくっと開ける）
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            style={{ width: '100%' }}
            maxLength={500}
          />
        </label>
        {error ? (
          <p role="alert" style={{ color: '#b00' }}>
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={submitDisabled} style={{ padding: 12 }}>
          {pending ? 'アップロード中…' : 'アップロードして次へ'}
        </button>
      </form>
    </div>
  );
}
