import "server-only";
// Выбор источника и сборка сводки. Источник — тот же, что у роутера: Supabase или MemoryStore.
import { getAiStore } from "@/lib/ai";
import { MemoryStore } from "@/lib/ai/store";
import { getDbOrNull } from "@/lib/db";
import { SupabaseSource, MemorySource, type AdminSource } from "./source";
import { summarize, usageWindowStart, type AdminSummary } from "./stats";
import type { ProviderView, RouteView } from "./routes";

export function getAdminSource(): AdminSource {
  const db = getDbOrNull();
  if (db) return new SupabaseSource(db);
  const store = getAiStore();
  return new MemorySource(store instanceof MemoryStore ? store : new MemoryStore());
}

export interface AdminData {
  source: AdminSource["kind"];
  summary: AdminSummary;
  routes: RouteView[];
  providers: ProviderView[];
}

export async function loadAdminData(now: Date = new Date()): Promise<AdminData> {
  const source = getAdminSource();
  const routes = await source.listRoutes();
  const [providers, rows, errors] = await Promise.all([
    source.listProviders(routes),
    source.usageSince(usageWindowStart(now)),
    source.recentErrors(20),
  ]);
  return { source: source.kind, summary: summarize({ rows, routes, providers, errors, now }), routes, providers };
}
