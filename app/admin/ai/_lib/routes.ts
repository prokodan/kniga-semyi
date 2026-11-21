// Маршруты и настройки провайдеров в админке: разбор строк из базы и чистые правки.
// Важно: список моделей шага — это данные из ai_routes (их же меняет workflow ai-models, I2).
// Правки адресуют строку по индексу И по provider+model: если таблица изменилась, правка отклоняется.
import { z } from "zod";
import { DEFAULT_PROVIDERS, DEFAULT_ROUTES, type ProviderSettings, type Route, type RouteEntry } from "@/lib/ai/config";
import { AI_STEPS, type AiProviderName, type AiStep } from "@/lib/ai/types";

export interface RouteView extends Route {
  /** db — строка есть в ai_routes; default — строки нет, роутер берёт значения из lib/ai/config.ts */
  source: "db" | "default";
  updated_at: string | null;
}

export interface ProviderView extends ProviderSettings {
  source: "db" | "default";
}

export class AdminEditError extends Error {}

const entrySchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  daily_limit: z.number().nullish(),
  threshold: z.number().nullish(),
});

/** Строка ai_routes → RouteView. Неизвестные поля записей сохраняются как есть. */
export function parseRouteRow(step: AiStep, row: Record<string, unknown> | null | undefined): RouteView {
  const fallback = DEFAULT_ROUTES[step];
  if (!row) return { ...fallback, source: "default", updated_at: null };
  const raw = Array.isArray(row.providers) ? row.providers : [];
  const providers = raw
    .filter((e) => entrySchema.safeParse(e).success)
    .map((e) => {
      const entry = { ...(e as Record<string, unknown>) } as unknown as RouteEntry;
      if (entry.daily_limit === null) delete entry.daily_limit;
      if (entry.threshold === null) delete entry.threshold;
      return entry;
    });
  return {
    step,
    providers,
    pinned_provider: (row.pinned_provider as AiProviderName | null) ?? null,
    timeout_ms: typeof row.timeout_ms === "number" ? row.timeout_ms : fallback.timeout_ms,
    enabled: row.enabled !== false,
    source: "db",
    updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

/** Все шаги из контракта (AI_STEPS) + строки базы. Шаги, которых нет в контракте, тоже показываем. */
export function mergeRoutes(rows: Record<string, unknown>[]): RouteView[] {
  const byStep = new Map(rows.map((r) => [String(r.step), r]));
  const known = AI_STEPS.map((step) => parseRouteRow(step, byStep.get(step)));
  const extra = rows
    .filter((r) => !(AI_STEPS as readonly string[]).includes(String(r.step)))
    .map((r) => ({ ...parseRouteRow("edit", r), step: String(r.step) as AiStep }));
  return [...known, ...extra];
}

export function parseProviderRow(row: Record<string, unknown>): ProviderView {
  const provider = String(row.provider) as AiProviderName;
  const base = DEFAULT_PROVIDERS[provider];
  const money = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    provider,
    enabled: row.enabled !== false,
    paid: typeof row.paid === "boolean" ? row.paid : (base?.paid ?? false),
    daily_budget_usd: money(row.daily_budget_usd),
    monthly_budget_usd: money(row.monthly_budget_usd),
    cooldown_minutes: typeof row.cooldown_minutes === "number" ? row.cooldown_minutes : (base?.cooldown_minutes ?? 10),
    source: "db",
  };
}

/** Строки ai_providers + провайдеры из маршрутов, у которых строки ещё нет (кроме mock). */
export function mergeProviders(rows: Record<string, unknown>[], routes: RouteView[]): ProviderView[] {
  const list = rows.map(parseProviderRow);
  const have = new Set<string>(list.map((p) => p.provider));
  const used = new Set<string>(routes.flatMap((r) => r.providers.map((e) => e.provider)));
  for (const name of ["gemini", "openai", ...used]) {
    if (have.has(name) || name === "mock") continue;
    const base = DEFAULT_PROVIDERS[name as AiProviderName];
    list.push(
      base
        ? { ...base, source: "default" }
        : {
            provider: name as AiProviderName,
            enabled: true,
            paid: false,
            daily_budget_usd: null,
            monthly_budget_usd: null,
            cooldown_minutes: 10,
            source: "default",
          },
    );
    have.add(name);
  }
  return list.sort((a, b) => a.provider.localeCompare(b.provider));
}

// ---------------- Правки (чистые) ----------------

export interface EntryRef {
  index: number;
  provider: string;
  model: string;
}

function checkRef(entries: RouteEntry[], ref: EntryRef) {
  const e = entries[ref.index];
  if (!e || e.provider !== ref.provider || e.model !== ref.model) {
    throw new AdminEditError("Маршрут успел измениться (например, обновились модели). Обновите страницу и повторите.");
  }
}

export function moveEntry(entries: RouteEntry[], ref: EntryRef, dir: "up" | "down"): RouteEntry[] {
  checkRef(entries, ref);
  const to = dir === "up" ? ref.index - 1 : ref.index + 1;
  if (to < 0 || to >= entries.length) return entries;
  const next = [...entries];
  const a = next[ref.index]!;
  next[ref.index] = next[to]!;
  next[to] = a;
  return next;
}

export function setEntryLimits(
  entries: RouteEntry[],
  ref: EntryRef,
  limits: { daily_limit: number | null; threshold: number | null },
): RouteEntry[] {
  checkRef(entries, ref);
  return entries.map((e, i) => {
    if (i !== ref.index) return e;
    const next: RouteEntry = { ...e };
    if (limits.daily_limit === null) delete next.daily_limit;
    else next.daily_limit = limits.daily_limit;
    if (limits.threshold === null) delete next.threshold;
    else next.threshold = limits.threshold;
    return next;
  });
}

export function checkPinned(route: Route, provider: string | null): AiProviderName | null {
  if (provider === null) return null;
  if (!route.providers.some((e) => e.provider === provider)) {
    throw new AdminEditError(`Провайдера ${provider} нет в маршруте шага ${route.step}.`);
  }
  return provider as AiProviderName;
}

// ---------------- Разбор полей формы ----------------

/** Пустое поле → null; иначе неотрицательное число в пределах. */
export function parseOptionalNumber(
  raw: FormDataEntryValue | null,
  opts: { min?: number; max?: number; int?: boolean; label: string },
): number | null {
  const s = typeof raw === "string" ? raw.trim().replace(",", ".") : "";
  if (s === "") return null;
  const n = Number(s);
  const min = opts.min ?? 0;
  if (!Number.isFinite(n) || n < min || (opts.max !== undefined && n > opts.max) || (opts.int && !Number.isInteger(n))) {
    const range = opts.max !== undefined ? `от ${min} до ${opts.max}` : `не меньше ${min}`;
    throw new AdminEditError(`${opts.label}: нужно ${opts.int ? "целое " : ""}число ${range}.`);
  }
  return n;
}

/** Порог в процентах из формы (10–100) → доля (0.1–1). */
export function parseThresholdPct(raw: FormDataEntryValue | null): number | null {
  const pct = parseOptionalNumber(raw, { min: 10, max: 100, label: "Порог" });
  return pct === null ? null : Math.round(pct * 10) / 1000;
}
