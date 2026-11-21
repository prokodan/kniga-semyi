// Источник данных админки: Supabase (прод) или MemoryStore роутера (локально без базы).
// Пишем только в ai_routes / ai_providers — роутер читает их на каждом вызове, деплой не нужен.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProviderSettings, RouteEntry } from "@/lib/ai/config";
import type { MemoryStore } from "@/lib/ai/store";
import type { AiProviderName, AiStep } from "@/lib/ai/types";
import { AdminEditError, mergeProviders, mergeRoutes, parseRouteRow, type ProviderView, type RouteView } from "./routes";
import type { UsageError, UsageLite } from "./stats";

export interface RoutePatch {
  providers?: RouteEntry[];
  pinned_provider?: AiProviderName | null;
  enabled?: boolean;
}

export type ProviderPatch = Partial<Omit<ProviderSettings, "provider">>;

export interface AdminSource {
  kind: "supabase" | "memory";
  listRoutes(): Promise<RouteView[]>;
  getRoute(step: AiStep): Promise<RouteView>;
  listProviders(routes: RouteView[]): Promise<ProviderView[]>;
  usageSince(since: Date): Promise<UsageLite[]>;
  recentErrors(limit: number): Promise<UsageError[]>;
  saveRoute(step: AiStep, patch: RoutePatch): Promise<void>;
  saveProvider(provider: string, patch: ProviderPatch): Promise<void>;
}

const USAGE_COLUMNS = "step, provider, model, status, cost_usd, created_at";
const PAGE = 1000;
const MAX_PAGES = 50;
const ERROR_STATUSES = ["error", "rate_limited", "timeout"];

export class SupabaseSource implements AdminSource {
  kind = "supabase" as const;
  constructor(private db: SupabaseClient) {}

  private fail(what: string, error: { message: string } | null) {
    if (error) throw new Error(`${what}: ${error.message}`);
  }

  async listRoutes() {
    const { data, error } = await this.db.from("ai_routes").select("*");
    this.fail("ai_routes", error);
    return mergeRoutes((data ?? []) as Record<string, unknown>[]);
  }

  async getRoute(step: AiStep) {
    const { data, error } = await this.db.from("ai_routes").select("*").eq("step", step).maybeSingle();
    this.fail("ai_routes", error);
    return parseRouteRow(step, data as Record<string, unknown> | null);
  }

  async listProviders(routes: RouteView[]) {
    const { data, error } = await this.db.from("ai_providers").select("*");
    this.fail("ai_providers", error);
    return mergeProviders((data ?? []) as Record<string, unknown>[], routes);
  }

  async usageSince(since: Date) {
    const rows: UsageLite[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, error } = await this.db
        .from("ai_usage")
        .select(USAGE_COLUMNS)
        .gte("created_at", since.toISOString())
        .order("id", { ascending: true })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      this.fail("ai_usage", error);
      rows.push(...((data ?? []) as UsageLite[]));
      if (!data || data.length < PAGE) break;
    }
    return rows;
  }

  async recentErrors(limit: number) {
    const { data, error } = await this.db
      .from("ai_usage")
      .select(`${USAGE_COLUMNS}, error`)
      .in("status", ERROR_STATUSES)
      .order("created_at", { ascending: false })
      .limit(limit);
    this.fail("ai_usage", error);
    return (data ?? []) as UsageError[];
  }

  async saveRoute(step: AiStep, patch: RoutePatch) {
    const current = await this.getRoute(step);
    if (current.source === "db") {
      const { error } = await this.db.from("ai_routes").update(patch).eq("step", step);
      this.fail("ai_routes", error);
      return;
    }
    // Строки нет — создаём из значений по умолчанию (как их видит роутер) с правкой поверх.
    const { error } = await this.db.from("ai_routes").insert({
      step,
      providers: patch.providers ?? current.providers,
      pinned_provider: patch.pinned_provider !== undefined ? patch.pinned_provider : current.pinned_provider,
      timeout_ms: current.timeout_ms,
      enabled: patch.enabled ?? current.enabled,
    });
    this.fail("ai_routes", error);
  }

  async saveProvider(provider: string, patch: ProviderPatch) {
    const { data, error } = await this.db.from("ai_providers").select("provider").eq("provider", provider).maybeSingle();
    this.fail("ai_providers", error);
    if (data) {
      const res = await this.db.from("ai_providers").update(patch).eq("provider", provider);
      this.fail("ai_providers", res.error);
      return;
    }
    const routes = await this.listRoutes();
    const base = mergeProviders([], routes).find((p) => p.provider === provider);
    if (!base) throw new AdminEditError(`Неизвестный провайдер ${provider}.`);
    const { source: _source, ...settings } = base;
    void _source;
    const res = await this.db.from("ai_providers").insert({ ...settings, ...patch, provider });
    this.fail("ai_providers", res.error);
  }
}

/** Локально без базы: читаем и правим тот же MemoryStore, которым пользуется роутер. */
export class MemorySource implements AdminSource {
  kind = "memory" as const;
  constructor(private store: MemoryStore) {}

  async listRoutes() {
    const rows = Object.values(this.store.routes).map((r) => ({ ...r }) as unknown as Record<string, unknown>);
    return mergeRoutes(rows);
  }

  async getRoute(step: AiStep) {
    const r = this.store.routes[step];
    return parseRouteRow(step, r ? ({ ...r } as unknown as Record<string, unknown>) : null);
  }

  async listProviders(routes: RouteView[]) {
    const rows = Object.values(this.store.providers).map((p) => ({ ...p }) as unknown as Record<string, unknown>);
    return mergeProviders(rows, routes);
  }

  async usageSince(since: Date) {
    return this.store.usage.filter((r) => new Date(r.created_at) >= since).map((r) => ({ ...r }));
  }

  async recentErrors(limit: number) {
    return this.store.usage
      .filter((r) => ERROR_STATUSES.includes(r.status))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit)
      .map((r) => ({ ...r, error: r.error ?? null }));
  }

  async saveRoute(step: AiStep, patch: RoutePatch) {
    const current = await this.getRoute(step);
    const { source: _s, updated_at: _u, ...route } = current;
    void _s;
    void _u;
    this.store.routes[step] = { ...route, ...patch };
  }

  async saveProvider(provider: string, patch: ProviderPatch) {
    const routes = await this.listRoutes();
    const current = (await this.listProviders(routes)).find((p) => p.provider === provider);
    if (!current) throw new AdminEditError(`Неизвестный провайдер ${provider}.`);
    const { source: _s, ...settings } = current;
    void _s;
    this.store.providers[provider as AiProviderName] = { ...settings, ...patch };
  }
}
