// Сводка для админки ИИ: расход, квоты, кэш, «остывание». Чистые функции — без базы, легко тестировать.
// Правила подсчёта совпадают с роутером (lib/ai/router.ts):
//   квота модели  — вызовы ok + error с начала суток в QUOTA_TIMEZONE провайдера (Gemini — Тихоокеанское);
//   бюджет $      — сумма cost_usd с начала суток / месяца UTC;
//   остывание     — был rate_limited / timeout за последние cooldown_minutes.
// Модели и лимиты берутся только из маршрутов (ai_routes), ID моделей здесь не зашиты.
import { DEFAULT_THRESHOLD, QUOTA_TIMEZONE, type ProviderSettings } from "@/lib/ai/config";
import type { AiProviderName } from "@/lib/ai/types";
import { startOfDayInTz, startOfUtcMonth } from "@/lib/ai/util";
import type { RouteView } from "./routes";

export interface UsageLite {
  step: string;
  provider: string;
  model: string;
  status: string;
  cost_usd: number | string;
  created_at: string;
}

export interface UsageError extends UsageLite {
  error: string | null;
}

export interface SpendRow {
  provider: string;
  enabled: boolean;
  paid: boolean;
  today: number;
  month: number;
  dailyBudget: number | null;
  monthlyBudget: number | null;
  /** Доля дневного / месячного бюджета, 0..∞ (null — бюджета нет) */
  todayPct: number | null;
  monthPct: number | null;
  /** Оценка на конец месяца при текущем темпе */
  forecastMonth: number;
  callsToday: number;
  callsMonth: number;
}

export interface QuotaRow {
  provider: string;
  model: string;
  used: number;
  limit: number;
  threshold: number;
  /** После этого числа вызовов роутер переходит к следующему провайдеру */
  cap: number;
  /** used / limit */
  pct: number;
  state: "ok" | "near" | "over";
  steps: string[];
  timeZone: string;
  resetsAt: string;
}

export interface CoolingRow {
  provider: string;
  model: string;
  status: string;
  failedAt: string;
  until: string;
}

export interface CacheShare {
  hits: number;
  calls: number;
  /** hits / (hits + calls), 0..1 */
  share: number;
}

export interface AdminSummary {
  now: string;
  spend: SpendRow[];
  totals: { today: number; month: number; forecastMonth: number };
  quotas: QuotaRow[];
  /** Модели из маршрутов без суточной квоты (обычно платные) */
  unlimited: { provider: string; model: string; callsToday: number; steps: string[] }[];
  cache: { today: CacheShare; month: CacheShare };
  cooling: CoolingRow[];
  errors: UsageError[];
}

const QUOTA_STATUSES = new Set(["ok", "error"]);
const FAILURE_STATUSES = new Set(["rate_limited", "timeout"]);

const num = (v: number | string | null | undefined) => (v === null || v === undefined ? 0 : Number(v) || 0);
const round = (v: number) => Math.round(v * 1e6) / 1e6;

function tzOf(provider: string): string {
  return QUOTA_TIMEZONE[provider as AiProviderName] ?? "UTC";
}

/** Начало «суток квоты» для провайдера, общий вход для выборки ai_usage. */
export function usageWindowStart(now: Date): Date {
  const starts = [startOfUtcMonth(now), ...Object.values(QUOTA_TIMEZONE).map((tz) => startOfDayInTz(tz, now))];
  return new Date(Math.min(...starts.map((d) => d.getTime())));
}

/** Следующая полночь в часовом поясе (момент UTC). Сдвиг на 26 ч страхует переход на летнее время. */
export function nextResetInTz(timeZone: string, now: Date): Date {
  const start = startOfDayInTz(timeZone, now);
  const guess = startOfDayInTz(timeZone, new Date(start.getTime() + 26 * 3_600_000));
  // В день перевода часов вычитание «прошедших часов» промахивается на час — подправляем по факту.
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "2-digit" }).format(guess),
  );
  if (hour === 23) return new Date(guess.getTime() + 3_600_000);
  if (hour === 1) return new Date(guess.getTime() - 3_600_000);
  return guess;
}

function daysInUtcMonth(now: Date): number {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
}

export function summarize(args: {
  rows: UsageLite[];
  routes: RouteView[];
  providers: ProviderSettings[];
  errors?: UsageError[];
  now: Date;
}): AdminSummary {
  const { rows, routes, providers, now } = args;
  const t = now.getTime();
  const dayUtc = startOfDayInTz("UTC", now).getTime();
  const monthUtc = startOfUtcMonth(now).getTime();
  const at = (r: UsageLite) => new Date(r.created_at).getTime();

  // ---------- Расход по провайдерам ----------
  const elapsedDays = Math.max((t - monthUtc) / 86_400_000, 1);
  const dim = daysInUtcMonth(now);
  const providerNames = new Set<string>(providers.map((p) => p.provider));
  for (const r of rows) if (r.provider !== "cache") providerNames.add(r.provider);
  const settingsOf = new Map(providers.map((p) => [p.provider as string, p]));

  const spend: SpendRow[] = [...providerNames].map((provider) => {
    const s = settingsOf.get(provider);
    const mine = rows.filter((r) => r.provider === provider && at(r) >= monthUtc && at(r) <= t);
    const today = mine.filter((r) => at(r) >= dayUtc);
    const sum = (list: UsageLite[]) => round(list.reduce((acc, r) => acc + num(r.cost_usd), 0));
    const called = (list: UsageLite[]) => list.filter((r) => QUOTA_STATUSES.has(r.status)).length;
    const month = sum(mine);
    const dailyBudget = s?.daily_budget_usd ?? null;
    const monthlyBudget = s?.monthly_budget_usd ?? null;
    const todaySum = sum(today);
    return {
      provider,
      enabled: s?.enabled ?? true,
      paid: s?.paid ?? false,
      today: todaySum,
      month,
      dailyBudget,
      monthlyBudget,
      todayPct: dailyBudget ? todaySum / dailyBudget : null,
      monthPct: monthlyBudget ? month / monthlyBudget : null,
      forecastMonth: round((month / elapsedDays) * dim),
      callsToday: called(today),
      callsMonth: called(mine),
    };
  });
  spend.sort((a, b) => b.month - a.month || a.provider.localeCompare(b.provider));

  // ---------- Квоты моделей (из маршрутов) ----------
  type Acc = { provider: string; model: string; limit?: number; threshold: number; steps: Set<string> };
  const models = new Map<string, Acc>();
  for (const route of routes) {
    for (const e of route.providers) {
      const key = `${e.provider}|${e.model}`;
      const acc = models.get(key) ?? { provider: e.provider, model: e.model, threshold: 1, steps: new Set<string>() };
      acc.steps.add(route.step);
      if (e.daily_limit !== undefined && e.daily_limit !== null) {
        const cap = e.daily_limit * (e.threshold ?? DEFAULT_THRESHOLD);
        const prevCap = acc.limit === undefined ? Infinity : acc.limit * acc.threshold;
        // Одна модель в нескольких шагах: показываем самый строгий порог — до него роутер её точно берёт.
        if (cap < prevCap) {
          acc.limit = e.daily_limit;
          acc.threshold = e.threshold ?? DEFAULT_THRESHOLD;
        }
      }
      models.set(key, acc);
    }
  }

  const quotas: QuotaRow[] = [];
  const unlimited: AdminSummary["unlimited"] = [];
  for (const m of models.values()) {
    const tz = tzOf(m.provider);
    const since = startOfDayInTz(tz, now).getTime();
    const used = rows.filter(
      (r) => r.provider === m.provider && r.model === m.model && QUOTA_STATUSES.has(r.status) && at(r) >= since && at(r) <= t,
    ).length;
    const steps = [...m.steps];
    if (m.limit === undefined) {
      unlimited.push({ provider: m.provider, model: m.model, callsToday: used, steps });
      continue;
    }
    const cap = Math.floor(m.limit * m.threshold);
    const pct = m.limit > 0 ? used / m.limit : 1;
    quotas.push({
      provider: m.provider,
      model: m.model,
      used,
      limit: m.limit,
      threshold: m.threshold,
      cap,
      pct,
      state: used >= cap ? "over" : used >= cap * 0.8 ? "near" : "ok",
      steps,
      timeZone: tz,
      resetsAt: nextResetInTz(tz, now).toISOString(),
    });
  }
  quotas.sort((a, b) => b.pct - a.pct);

  // ---------- Доля кэша ----------
  const share = (since: number): CacheShare => {
    const list = rows.filter((r) => at(r) >= since && at(r) <= t);
    const hits = list.filter((r) => r.status === "cache_hit").length;
    const calls = list.filter((r) => r.status === "ok").length;
    return { hits, calls, share: hits + calls > 0 ? hits / (hits + calls) : 0 };
  };

  // ---------- Остывание ----------
  const cooling: CoolingRow[] = [];
  for (const m of models.values()) {
    const minutes = settingsOf.get(m.provider)?.cooldown_minutes ?? 0;
    if (minutes <= 0) continue;
    const since = t - minutes * 60_000;
    const last = rows
      .filter((r) => r.provider === m.provider && r.model === m.model && FAILURE_STATUSES.has(r.status))
      .filter((r) => at(r) >= since && at(r) <= t)
      .sort((a, b) => at(b) - at(a))[0];
    if (last) {
      cooling.push({
        provider: m.provider,
        model: m.model,
        status: last.status,
        failedAt: new Date(at(last)).toISOString(),
        until: new Date(at(last) + minutes * 60_000).toISOString(),
      });
    }
  }

  return {
    now: now.toISOString(),
    spend,
    totals: {
      today: round(spend.reduce((s, r) => s + r.today, 0)),
      month: round(spend.reduce((s, r) => s + r.month, 0)),
      forecastMonth: round(spend.reduce((s, r) => s + r.forecastMonth, 0)),
    },
    quotas,
    unlimited,
    cache: { today: share(dayUtc), month: share(monthUtc) },
    cooling,
    errors: (args.errors ?? []).slice(0, 20),
  };
}
