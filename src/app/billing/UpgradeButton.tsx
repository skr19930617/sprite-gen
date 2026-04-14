'use client';

import { useState, useTransition } from 'react';

export default function UpgradeButton() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onClick = () => {
    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/stripe/checkout', { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.url) {
        setError(json.error ?? `Checkout 開始に失敗しました (${res.status})`);
        return;
      }
      window.location.href = json.url;
    });
  };

  return (
    <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
      <button onClick={onClick} disabled={pending} style={{ padding: 12 }}>
        {pending ? 'リダイレクト中…' : '有料プランにアップグレード'}
      </button>
      {error ? (
        <p role="alert" style={{ color: '#b00' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
