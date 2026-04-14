import { createClient } from '@/lib/supabase/server';
import { PLAN_LIMITS, isPlan } from '@/lib/quota/limits';
import {
  countSavedProjects,
  countSuccessGenerationsThisMonth,
} from '@/lib/quota/usage';
import UpgradeButton from './UpgradeButton';

export default async function BillingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return <p>ログインが必要です。</p>;
  }
  const profile = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', user.id)
    .single<{ plan: string }>();
  const plan = isPlan(profile.data?.plan ?? 'free')
    ? (profile.data?.plan as 'free' | 'paid')
    : 'free';

  const [usedGen, usedSaves] = await Promise.all([
    countSuccessGenerationsThisMonth(supabase, user.id),
    countSavedProjects(supabase, user.id),
  ]);
  const limits = PLAN_LIMITS[plan];

  return (
    <main style={{ maxWidth: 600, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Billing</h1>
      <p>
        現在のプラン:{' '}
        <strong>{plan === 'paid' ? '有料プラン' : '無料プラン'}</strong>
      </p>
      <ul>
        <li>
          今月の生成: {usedGen} / {limits.generationsPerMonth}
        </li>
        <li>
          保存中のプロジェクト: {usedSaves} / {limits.savedProjects}
        </li>
        <li>商用利用: {limits.commercialUseAllowed ? '可' : '不可'}</li>
      </ul>
      {plan === 'free' ? <UpgradeButton /> : <p>有料プランをご利用中です。</p>}
    </main>
  );
}
