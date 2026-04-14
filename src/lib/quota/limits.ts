export type Plan = 'free' | 'paid';

export type PlanLimit = {
  generationsPerMonth: number;
  savedProjects: number;
  commercialUseAllowed: boolean;
};

/**
 * Single source of truth for plan caps (proposal D8).
 * Quota helpers, billing UI, webhook messaging, and acceptance tests
 * MUST import from here — never inline the numbers.
 */
export const PLAN_LIMITS: Record<Plan, PlanLimit> = {
  free: {
    generationsPerMonth: 10,
    savedProjects: 5,
    commercialUseAllowed: false,
  },
  paid: {
    generationsPerMonth: 200,
    savedProjects: 100,
    commercialUseAllowed: true,
  },
} as const;

export const isPlan = (value: unknown): value is Plan =>
  value === 'free' || value === 'paid';
