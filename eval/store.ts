// Хранилище роутера для npm run eval (I11): всё в памяти, как в симуляторе, плюс
//   • маршруты: модели прода (EVAL_ROUTES_FILE = JSON {step: providers[]} из ai_routes) или lib/ai/config.ts.
//     Все шаги — только Gemini Flash-Lite (квота ~500/сутки), КРОМЕ back_translate: там порядок как в
//     маршруте (Flash раньше Flash-Lite), чтобы корейский проверяла другая модель, чем переводила;
//     EVAL_MODEL — одна модель для всех шагов, кроме back_translate;
//   • кэш ответов в файле (EVAL_CACHE_FILE): «до» и «после» в одном запуске и повторные запуски не тратят
//     квоту на шаги, чей промпт и вход не изменились (ключ кэша = шаг + версия промпта + вход).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_ROUTES, type Route, type RouteEntry } from "@/lib/ai/config";
import { MemoryStore } from "@/lib/ai/store";
import type { AiStep } from "@/lib/ai/types";

const isFlashLite = (e: RouteEntry) => e.provider === "gemini" && /flash-lite/.test(e.model);

/** Маршрут шага для оценки. Пороги квот снимаем: прод-счётчиков в памяти нет, лимит держит --max-calls. */
export function evalRoute(step: AiStep, fromDb: RouteEntry[] | null | undefined, model?: string): Route {
  const base = DEFAULT_ROUTES[step];
  const source = fromDb?.length ? fromDb : base.providers;
  let providers: RouteEntry[];
  if (step === "back_translate") providers = source;
  else if (model) providers = [{ provider: "gemini", model }];
  else {
    const fl = source.filter(isFlashLite);
    providers = fl.length ? fl : source;
  }
  return { ...base, providers: providers.map((p) => ({ provider: p.provider, model: p.model })), pinned_provider: null };
}

function readJson<T>(file: string | undefined, fallback: T): T {
  if (!file || !existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export class EvalStore extends MemoryStore {
  private readonly dbRoutes: Record<string, RouteEntry[] | null>;
  readonly cachedAtStart: number;

  constructor(
    private readonly opts: { routesFile?: string; cacheFile?: string; model?: string } = {},
  ) {
    super();
    this.dbRoutes = readJson(opts.routesFile, {});
    for (const [k, v] of Object.entries(readJson<Record<string, unknown>>(opts.cacheFile, {}))) this.cache.set(k, v);
    this.cachedAtStart = this.cache.size;
  }

  override async getRoute(step: AiStep) {
    return evalRoute(step, this.dbRoutes[step], this.opts.model);
  }

  override async cacheSet(hash: string, step: AiStep, provider: string, model: string, output: unknown) {
    await super.cacheSet(hash, step, provider, model, output);
    if (this.opts.cacheFile) writeFileSync(this.opts.cacheFile, JSON.stringify(Object.fromEntries(this.cache)));
  }
}
