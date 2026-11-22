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
// 4. Темп: бесплатный Gemini режет по запросам в минуту (429), а роутер после 429 «остывает» 10 минут —
//    и все главы прогона падают. Поэтому: не чаще одного реального запроса в SIM_MIN_INTERVAL_MS
//    (по умолчанию 6,5 с ≈ 9 в минуту), а после 429 — пауза SIM_RETRY_WAIT_MS (65 с) и повтор той же
//    модели (до 2 повторов на вызов) вместо остывания. Повтор после 429 квоту не тратит.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { RouteEntry } from "@/lib/ai/config";
import { DEFAULT_ROUTES } from "@/lib/ai/config";
import { MemoryStore } from "@/lib/ai/store";
import type { AiStep } from "@/lib/ai/types";

const ROUTES_FILE = process.env.SIM_ROUTES_FILE?.trim();
const MODEL = process.env.SIM_MODEL?.trim();
const CACHE_FILE = process.env.SIM_CACHE_FILE?.trim();
const USAGE_FILE = process.env.SIM_USAGE_FILE?.trim();
const MIN_INTERVAL_MS = Number(process.env.SIM_MIN_INTERVAL_MS || 6500);
const RETRY_WAIT_MS = Number(process.env.SIM_RETRY_WAIT_MS || 65_000);
const RETRIES = 2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastCallAt = 0;
let lastStatus: string | null = null;

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
  // getRoute вызывается только при промахе кэша — то есть перед реальным запросом: держим темп.
  const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
  lastStatus = null;
  attempt = 0;
  // Каждая модель — ещё RETRIES раз подряд: повтор после 429 (см. hadFailureSince ниже).
  const withRetries = providers.flatMap((p) => Array.from({ length: RETRIES + 1 }, () => p));
  return { ...base, providers: withRetries, pinned_provider: null };
};

// Роутер спрашивает «был ли 429 недавно?» перед каждой попыткой. Первая попытка — сразу; после 429 —
// ждём и пробуем снова; после успеха или другой ошибки повторы пропускаем.
let attempt = 0;
MemoryStore.prototype.hadFailureSince = async function hadFailureSince() {
  attempt += 1;
  if (attempt === 1) return false;
  if (lastStatus === "rate_limited") {
    console.error(`sim: 429 от Gemini — пауза ${Math.round(RETRY_WAIT_MS / 1000)} с и повтор`);
    await sleep(RETRY_WAIT_MS);
    lastCallAt = Date.now();
    return false;
  }
  return true; // успех уже вернулся или ошибка не про лимит — повтор не нужен
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
  if (row.status !== "cache_hit") lastStatus = row.status;
  return originalRecord.call(this, row);
};

process.on("exit", () => {
  if (!USAGE_FILE) return;
  writeFileSync(USAGE_FILE, JSON.stringify({ models, usage, cachedAtStart, cachedAtEnd: cache.size }, null, 2));
});
