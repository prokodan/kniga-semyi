// Типы для scripts/ai-config-sync.mjs (скрипт workflow — без сборки, тест — на TypeScript).
export type Budgets = Record<string, { daily: number | null; monthly: number | null }>;
export interface RouteRow {
  step: string;
  providers: unknown;
  pinned_provider?: string | null;
  timeout_ms?: number | null;
  enabled?: boolean | null;
}
export interface ProviderRow {
  provider: string;
  enabled?: boolean | null;
  paid?: boolean | null;
  daily_budget_usd?: number | string | null;
  monthly_budget_usd?: number | string | null;
  cooldown_minutes?: number | null;
}
export interface Plan {
  routes: Required<RouteRow>[];
  providers: Required<ProviderRow>[];
  budgetFrom: { row: Required<ProviderRow>; budgetFrom: "prod" | "staging" | "input" }[];
  extraSteps: string[];
}
export function parseBudgets(input: string | undefined | null): Budgets | "same" | null;
export function planStagingConfig(args: {
  prodRoutes: RouteRow[];
  prodProviders: ProviderRow[];
  stagingProviders: ProviderRow[];
  stagingSteps?: string[];
  budgets?: Budgets | "same" | null;
}): Plan;
export function reportMarkdown(plan: Plan): string;
