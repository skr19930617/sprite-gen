export default function HomePage() {
  return (
    <main style={{ padding: '3rem 1.5rem', maxWidth: 720, margin: '0 auto' }}>
      <h1>Sprite Generator</h1>
      <p>
        魚の透過PNGと自然言語指示から、ピクセルアニメGIFとスプライトシートを
        半自動で生成します。MVPの機能実装は進行中です。
      </p>
      <p>
        ログイン後に <code>/upload</code> から画像をアップロードしてください。
      </p>
    </main>
  );
}
