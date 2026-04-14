export default function BillingSuccessPage() {
  return (
    <main style={{ maxWidth: 600, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>お支払いを受け付けました</h1>
      <p>
        プラン更新が反映されるまで数秒かかる場合があります。{' '}
        <a href="/billing">Billing ページに戻る</a>
      </p>
    </main>
  );
}
