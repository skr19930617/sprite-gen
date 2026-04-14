import QuotaBadge from '@/components/QuotaBadge';
import { loadQuotaSummary } from '@/lib/quota/server-summary';
import UploadForm from './UploadForm';

export default async function UploadPage() {
  const summary = await loadQuotaSummary();
  return (
    <main style={{ maxWidth: 720, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>画像アップロード</h1>
      <QuotaBadge summary={summary} hideSaves />
      <UploadForm />
    </main>
  );
}
