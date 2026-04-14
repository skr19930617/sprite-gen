import type { SupabaseClient } from '@supabase/supabase-js';
import { PLAN_LIMITS, type Plan } from './limits';

/** Successful, counted generations in the current calendar month (UTC). */
export const countSuccessGenerationsThisMonth = async (
  supabase: SupabaseClient,
  userId: string,
): Promise<number> => {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const { count, error } = await supabase
    .from('generations')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'success')
    .eq('counted', true)
    .gte('created_at', start.toISOString());
  if (error) throw error;
  return count ?? 0;
};

/** Number of saved projects (drafts NOT counted). */
export const countSavedProjects = async (
  supabase: SupabaseClient,
  userId: string,
): Promise<number> => {
  const { count, error } = await supabase
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (error) throw error;
  return count ?? 0;
};

export const isOverGenerationCap = (used: number, plan: Plan): boolean =>
  used >= PLAN_LIMITS[plan].generationsPerMonth;

export const isOverSaveCap = (used: number, plan: Plan): boolean =>
  used >= PLAN_LIMITS[plan].savedProjects;
