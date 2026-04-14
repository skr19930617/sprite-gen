'use client';

import { useState, useTransition } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const supabase = createClient();
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/upload`,
        },
      });
      if (signUpError) {
        setError(signUpError.message);
        return;
      }
      setInfo(
        '確認メールを送信しました。メール内のリンクをクリックしてください。',
      );
    });
  };

  return (
    <main style={{ maxWidth: 400, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>サインアップ</h1>
      <form
        onSubmit={onSubmit}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <label>
          メールアドレス
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ width: '100%', padding: 8 }}
          />
        </label>
        <label>
          パスワード（8文字以上）
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ width: '100%', padding: 8 }}
          />
        </label>
        {error ? (
          <p role="alert" style={{ color: '#b00' }}>
            {error}
          </p>
        ) : null}
        {info ? (
          <p role="status" style={{ color: '#060' }}>
            {info}
          </p>
        ) : null}
        <button type="submit" disabled={pending} style={{ padding: 10 }}>
          {pending ? '送信中…' : '登録'}
        </button>
      </form>
      <p style={{ marginTop: 16 }}>
        既にアカウントをお持ちの方は <a href="/login">ログイン</a>
      </p>
    </main>
  );
}
