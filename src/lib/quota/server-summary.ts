import { createClient } from '@/lib/supabase/server';
import { isPlan, PLAN_LIMITS, type Plan } from './limits';
import { countSavedProjects, countSuccessGenerationsThisMonth } from './usage';

export type QuotaSummary = {
  plan: Plan;
  generationsUsed: number;
  generationsCap: number;
  savesUsed: number;
  savesCap: number;
  commercialUseAllowed: boolean;
};

/**
 * Server-side helper for any RSC that wants to display the user's quota state.
 * Returns null when there is no authenticated session.
 */
export const loadQuotaSummary = async (): Promise<QuotaSummary | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const profile = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', user.id)
    .single<{ plan: string }>();
  const plan: Plan = isPlan(profile.data?.plan ?? 'free')
    ? (profile.data?.plan as Plan)
    : 'free';
  const [generationsUsed, savesUsed] = await Promise.all([
    countSuccessGenerationsThisMonth(supabase, user.id),
    countSavedProjects(supabase, user.id),
  ]);
  const limits = PLAN_LIMITS[plan];
  return {
    plan,
    generationsUsed,
    generationsCap: limits.generationsPerMonth,
    savesUsed,
    savesCap: limits.savedProjects,
    commercialUseAllowed: limits.commercialUseAllowed,
  };
};
