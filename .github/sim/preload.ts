// Предзагрузка для workflow sim (только CI, в приложение не попадает):
//   tsx --import ./.github/sim/preload.ts scripts/sim.ts --persona kim …
// Симулятор создаёт роутер с MemoryStore, поэтому здесь, не трогая lib/ai и eval/sim, подменяем
// три метода MemoryStore:
// 1. getRoute — модели из ai_routes прода (SIM_ROUTES_FILE, JSON {step: providers[]}) или SIM_MODEL;
//    оставляем только gemini Flash-Lite (квота ~500/сутки), чтобы прогон не ел 20/сутки у Flash и не ходил
//    в платный OpenAI. Нет ни того, ни другого — значения по умолчанию из lib/ai/config.ts.
// 2. cacheGet / cacheSet — кэш ответов в файле SIM_CACHE_FILE (между прогонами — actions/cache).
//    Ключ кэша = шаг + версия промпта + вход, поэтому при правке edit/translate диалог воспроизводится
//    бесплатно и один в один, а заново считаются только шаги с изменённым промптом: сравнение «до/после»
//    без шума и без лишней квоты.
// 3. recordUsage — считаем реальные запросы и попадания в кэш, итог пишем в SIM_USAGE_FILE.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { RouteEntry } from "@/lib/ai/config";
import { DEFAULT_ROUTES } from "@/lib/ai/config";
import { MemoryStore } from "@/lib/ai/store";
import type { AiStep } from "@/lib/ai/types";

const ROUTES_FILE = process.env.SIM_ROUTES_FILE?.trim();
const MODEL = process.env.SIM_MODEL?.trim();
const CACHE_FILE = process.env.SIM_CACHE_FILE?.trim();
const USAGE_FILE = process.env.SIM_USAGE_FILE?.trim();

function readJson<T>(file: string | undefined, fallback: T): T {
  if (!file || !existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

const isFlashLite = (e: RouteEntry) => e.provider === "gemini" && /flash-lite/.test(e.model);
const dbRoutes = readJson<Record<string, RouteEntry[] | null>>(ROUTES_FILE, {});
const models: Record<string, string> = {};

MemoryStore.prototype.getRoute = async function getRoute(this: MemoryStore, step: AiStep) {
  const base = this.routes[step] ?? DEFAULT_ROUTES[step];
  let providers: RouteEntry[];
  if (MODEL) providers = [{ provider: "gemini", model: MODEL }];
  else {
    const fromDb = (dbRoutes[step] ?? []).filter(isFlashLite);
    providers = fromDb.length ? fromDb : base.providers.filter(isFlashLite);
    if (!providers.length) providers = base.providers;
  }
  // Квоту прода роутер в памяти не видит — снимаем порог, лимит держит --max-calls симулятора.
  providers = providers.map((p) => ({ provider: p.provider, model: p.model }));
  models[step] = providers.map((p) => p.model).join(" → ");
  return { ...base, providers, pinned_provider: null };
};

const cache = new Map<string, unknown>(Object.entries(readJson<Record<string, unknown>>(CACHE_FILE, {})));
const cachedAtStart = cache.size;

MemoryStore.prototype.cacheGet = async function cacheGet(hash: string) {
  return cache.get(hash) ?? null;
};
MemoryStore.prototype.cacheSet = async function cacheSet(hash: string, _step: AiStep, _p: string, _m: string, output: unknown) {
  cache.set(hash, output);
  if (CACHE_FILE) writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(cache)));
};

type Row = Parameters<MemoryStore["recordUsage"]>[0];
const usage: Record<string, Record<string, number>> = {};
const originalRecord = MemoryStore.prototype.recordUsage;
MemoryStore.prototype.recordUsage = async function recordUsage(this: MemoryStore, row: Row) {
  const byStatus = (usage[row.step] ??= {});
  byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
  return originalRecord.call(this, row);
};

process.on("exit", () => {
  if (!USAGE_FILE) return;
  writeFileSync(USAGE_FILE, JSON.stringify({ models, usage, cachedAtStart, cachedAtEnd: cache.size }, null, 2));
});
