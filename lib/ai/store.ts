// Хранилище роутера: маршруты, настройки провайдеров, счётчики квот и бюджета, кэш.
// SupabaseStore — в проде (таблицы ai_routes, ai_providers, ai_usage, ai_cache),
// MemoryStore — в тестах и когда база не настроена.
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_PROVIDERS, DEFAULT_ROUTES, type ProviderSettings, type Route } from "./config";
import type { AiProviderName, AiStep } from "./types";

export type UsageStatus = "ok" | "error" | "rate_limited" | "timeout" | "cache_hit";

/** Неудачи, после которых модель «остывает» (503 / прочие ошибки — нет: перегрузка обычно секундная). */
export const COOLDOWN_STATUSES: UsageStatus[] = ["rate_limited", "timeout"];

/**
 * #218: строки другого окружения, которые прод хранит только для отчёта /admin/ai. Превью (staging) шлёт свои строки
 * в прод (env='staging') — их нельзя учитывать в квотах, «остывании» и бюджете прода: у превью свои ключи ИИ и
 * свой бюджет. В базе staging строк прода нет, поэтому превью считает всё по своей базе.
 */
export const FOREIGN_USAGE_ENVS = ["staging"] as const;

/** Учитывать ли строку в квотах / остывании / бюджете этого окружения (env пустой = старая строка = prod). */
export function isOwnUsage(rowEnv: string | null | undefined, storeEnv: "prod" | "staging" | undefined): boolean {
  if (storeEnv === "staging") return true;
  return !(FOREIGN_USAGE_ENVS as readonly string[]).includes(rowEnv ?? "prod");
}

export interface UsageRow {
  step: AiStep;
  provider: string;
  model: string;
  status: UsageStatus;
  input_tokens?: number;
  output_tokens?: number;
  audio_seconds?: number;
  images?: number;
  cost_usd: number;
  latency_ms?: number;
  error?: string;
  story_id?: string;
  /** #204: семья вызова (сказка и картинки — без story_id). Нет колонки (до migrate) — строка пишется без неё. */
  family_id?: string;
  created_at?: string;
  /** #211: откуда вызов — 'prod' | 'staging'. Не задано → default колонки ('prod'); прод его не передаёт. */
  env?: "prod" | "staging";
}

export interface AiStore {
  getRoute(step: AiStep): Promise<Route>;
  getProviderSettings(provider: AiProviderName): Promise<ProviderSettings>;
  /** Вызовы модели (ok + error), которые расходуют квоту, начиная с since */
  countCalls(provider: string, model: string, since: Date): Promise<number>;
  /** Сумма cost_usd провайдера начиная с since */
  spend(provider: string, since: Date): Promise<number>;
  /** Была ли у модели неудача из `statuses` (по умолчанию 429 и таймаут) с момента `since` — для «остывания». */
  hadFailureSince(provider: string, model: string, since: Date, statuses?: UsageStatus[]): Promise<boolean>;
  recordUsage(row: UsageRow): Promise<void>;
  cacheGet(hash: string): Promise<unknown | null>;
  cacheSet(hash: string, step: AiStep, provider: string, model: string, output: unknown): Promise<void>;
}

// ---------------- Memory ----------------

export class MemoryStore implements AiStore {
  usage: (UsageRow & { created_at: string })[] = [];
  cache = new Map<string, unknown>();
  routes: Partial<Record<AiStep, Route>> = {};
  providers: Partial<Record<AiProviderName, ProviderSettings>> = {};
  now: () => Date = () => new Date();
  /** #218: как у SupabaseStore — undefined / 'prod' = прод (строки staging не считаются), 'staging' = своя база */
  env: "prod" | "staging" | undefined = undefined;

  async getRoute(step: AiStep) {
    return this.routes[step] ?? DEFAULT_ROUTES[step];
  }
  async getProviderSettings(provider: AiProviderName) {
    return this.providers[provider] ?? DEFAULT_PROVIDERS[provider];
  }
  private since(rows: typeof this.usage, since: Date) {
    return rows.filter((r) => new Date(r.created_at) >= since && isOwnUsage(r.env, this.env));
  }
  async countCalls(provider: string, model: string, since: Date) {
    return this.since(this.usage, since).filter(
      (r) => r.provider === provider && r.model === model && (r.status === "ok" || r.status === "error"),
    ).length;
  }
  async spend(provider: string, since: Date) {
    return this.since(this.usage, since)
      .filter((r) => r.provider === provider)
      .reduce((s, r) => s + r.cost_usd, 0);
  }
  async hadFailureSince(provider: string, model: string, since: Date, statuses: UsageStatus[] = COOLDOWN_STATUSES) {
    return this.since(this.usage, since).some((r) => r.provider === provider && r.model === model && statuses.includes(r.status));
  }
  async recordUsage(row: UsageRow) {
    this.usage.push({ ...row, created_at: row.created_at ?? this.now().toISOString() });
  }
  async cacheGet(hash: string) {
    return this.cache.get(hash) ?? null;
  }
  async cacheSet(hash: string, _step: AiStep, _provider: string, _model: string, output: unknown) {
    this.cache.set(hash, output);
  }
}

// ---------------- Supabase ----------------

export class SupabaseStore implements AiStore {
  /** env — #211: превью пишет свои строки как 'staging'; прод не передаёт (default колонки 'prod'). */
  constructor(
    private db: SupabaseClient,
    private env?: "prod" | "staging",
  ) {}

  async getRoute(step: AiStep): Promise<Route> {
    const { data } = await this.db.from("ai_routes").select("*").eq("step", step).maybeSingle();
    if (!data) return DEFAULT_ROUTES[step];
    return {
      step,
      providers: Array.isArray(data.providers) ? data.providers : DEFAULT_ROUTES[step].providers,
      pinned_provider: data.pinned_provider ?? null,
      timeout_ms: data.timeout_ms ?? DEFAULT_ROUTES[step].timeout_ms,
      enabled: data.enabled ?? true,
    };
  }

  async getProviderSettings(provider: AiProviderName): Promise<ProviderSettings> {
    const { data } = await this.db.from("ai_providers").select("*").eq("provider", provider).maybeSingle();
    if (!data) return DEFAULT_PROVIDERS[provider];
    return {
      provider,
      enabled: data.enabled,
      paid: data.paid,
      daily_budget_usd: data.daily_budget_usd === null ? null : Number(data.daily_budget_usd),
      monthly_budget_usd: data.monthly_budget_usd === null ? null : Number(data.monthly_budget_usd),
      cooldown_minutes: data.cooldown_minutes,
    };
  }

  /**
   * #218: прод не учитывает строки staging (их присылает превью — только для отчёта). Колонка env — not null default
   * 'prod', поэтому `env not in (staging)` берёт и старые строки. Превью считает всё в своей базе.
   */
  private ownEnv<Q extends { not(column: "env", op: "in", value: string): Q }>(query: Q): Q {
    if (this.env === "staging") return query;
    return query.not("env", "in", `(${FOREIGN_USAGE_ENVS.join(",")})`);
  }

  async countCalls(provider: string, model: string, since: Date) {
    const { count } = await this.ownEnv(
      this.db
        .from("ai_usage")
        .select("id", { count: "exact", head: true })
        .eq("provider", provider)
        .eq("model", model)
        .in("status", ["ok", "error"])
        .gte("created_at", since.toISOString()),
    );
    return count ?? 0;
  }

  async spend(provider: string, since: Date) {
    const { data } = await this.ownEnv(
      this.db
        .from("ai_usage")
        .select("cost_usd")
        .eq("provider", provider)
        .gt("cost_usd", 0)
        .gte("created_at", since.toISOString()),
    );
    return (data ?? []).reduce((s, r) => s + Number(r.cost_usd), 0);
  }

  async hadFailureSince(provider: string, model: string, since: Date, statuses: UsageStatus[] = COOLDOWN_STATUSES) {
    const { count } = await this.ownEnv(
      this.db
        .from("ai_usage")
        .select("id", { count: "exact", head: true })
        .eq("provider", provider)
        .eq("model", model)
        .in("status", statuses)
        .gte("created_at", since.toISOString()),
    );
    return (count ?? 0) > 0;
  }

  async recordUsage(input: UsageRow) {
    let row: UsageRow = this.env && input.env === undefined ? { ...input, env: this.env } : input;
    let { error } = await this.db.from("ai_usage").insert(row);
    // #211 / #204: база ещё без новой колонки (migrate не дошёл) или семьи уже нет (внешний ключ family_id) —
    // пишем без неё, расход не теряем.
    const retryWithout = [
      ["family_id", /family_id/],
      ["env", /\benv\b/],
    ] as const;
    for (const [column, pattern] of retryWithout) {
      if (!error || row[column] === undefined || !pattern.test(error.message)) continue;
      const { [column]: _dropped, ...rest } = row;
      void _dropped;
      row = rest;
      ({ error } = await this.db.from("ai_usage").insert(row));
    }
    if (error) console.error("[ai] не удалось записать ai_usage:", error.message);
  }

  async cacheGet(hash: string) {
    const { data } = await this.db.from("ai_cache").select("output").eq("input_hash", hash).maybeSingle();
    return data?.output ?? null;
  }

  async cacheSet(hash: string, step: AiStep, provider: string, model: string, output: unknown) {
    const { error } = await this.db
      .from("ai_cache")
      .upsert({ input_hash: hash, step, provider, model, output }, { onConflict: "input_hash" });
    if (error) console.error("[ai] не удалось записать ai_cache:", error.message);
  }
}
