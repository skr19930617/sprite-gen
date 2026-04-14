import Link from 'next/link';
import type { QuotaSummary } from '@/lib/quota/server-summary';

type Props = {
  summary: QuotaSummary | null;
  /** When true, hide save counts (e.g. on the upload page where it's irrelevant). */
  hideSaves?: boolean;
};

const isNearCap = (used: number, cap: number): boolean =>
  cap > 0 && used / cap >= 0.8;

export default function QuotaBadge({ summary, hideSaves = false }: Props) {
  if (!summary) return null;
  const genNear = isNearCap(summary.generationsUsed, summary.generationsCap);
  const saveNear = !hideSaves && isNearCap(summary.savesUsed, summary.savesCap);
  const showUpgrade = summary.plan === 'free' && (genNear || saveNear);
  return (
    <aside
      style={{
        border: '1px solid #ccc',
        padding: 8,
        borderRadius: 4,
        fontSize: 12,
        background: showUpgrade ? '#fff8e6' : '#fafafa',
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
      aria-label="quota status"
    >
      <span>
        プラン: <strong>{summary.plan === 'paid' ? '有料' : '無料'}</strong>
      </span>
      <span>
        今月の生成: {summary.generationsUsed}/{summary.generationsCap}
      </span>
      {hideSaves ? null : (
        <span>
          保存: {summary.savesUsed}/{summary.savesCap}
        </span>
      )}
      {showUpgrade ? (
        <Link href="/billing" style={{ marginLeft: 'auto', color: '#a60' }}>
          アップグレード →
        </Link>
      ) : null}
    </aside>
  );
}
