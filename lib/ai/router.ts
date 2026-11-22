// Роутер ИИ: «сначала бесплатное, потом платное».
// Для шага берёт упорядоченный список провайдеров (ai_routes) и выбирает первый подходящий:
//   выключен / нет ключа / не умеет шаг  → пропуск
//   «остывает» после 429 или таймаута     → пропуск (cooldown_minutes, по умолчанию 10)
//   квота за сутки ≥ daily_limit × threshold → пропуск
//   платный и бюджет дня/месяца исчерпан   → пропуск
//   429 / таймаут при вызове               → запись в ai_usage (запускает cooldown) → следующий
//   любая ошибка или неверный JSON         → запись → следующий
// Перед вызовом — кэш по sha256(шаг + версия промпта + вход). Все провайдеры отпали → AiUnavailableError.
import { getAiMode, type AiMode } from "@/lib/env";
import { DEFAULT_THRESHOLD, QUOTA_TIMEZONE, type RouteEntry } from "./config";
import { loadPrompt } from "./prompts";
import { geminiProvider } from "./providers/gemini";
import { mockProvider } from "./providers/mock";
import { openaiProvider } from "./providers/openai";
import type { AiStore, UsageStatus } from "./store";
import {
  AiUnavailableError,
  inputSchemas,
  outputSchemas,
  ProviderError,
  type AiInput,
  type AiOutput,
  type AiParsedInput,
  type AiProvider,
  type AiProviderName,
  type AiStep,
} from "./types";
import { estimateCostUsd, sha256, stableStringify, startOfDayInTz, startOfUtcMonth } from "./util";

export interface RunOptions {
  /** Для привязки расхода к истории в ai_usage */
  storyId?: string;
  /** Не читать кэш (запись в кэш всё равно будет) — для «перегенерировать» */
  noCache?: boolean;
  /**
   * Момент (мс epoch), к которому нужно уложить все попытки (лимит функции Vercel 60 с). Цепочка 3 × 30–45 с
   * в него не влезает: функцию убивали посреди шага и история навсегда оставалась «готовится…».
   * Таймаут попытки = min(таймаут маршрута, остаток); последней модели — весь остаток; остаток < 4 с — стоп.
   */
  deadline?: number;
}

/** Меньше этого до дедлайна — новую попытку не начинаем */
const MIN_ATTEMPT_MS = 4_000;

export interface RunResult<S extends AiStep> {
  output: AiOutput<S>;
  provider: AiProviderName | "cache";
  model: string;
  cached: boolean;
  attempts: { provider: string; model: string; reason: string }[];
}

export interface RouterDeps {
  store: AiStore;
  providers?: Partial<Record<AiProviderName, AiProvider>>;
  mode?: () => AiMode;
  now?: () => Date;
  loadPrompt?: typeof loadPrompt;
}

const DEFAULT_PROVIDER_IMPLS: Record<AiProviderName, AiProvider> = {
  mock: mockProvider,
  gemini: geminiProvider,
  openai: openaiProvider,
};

export function createRouter(deps: RouterDeps) {
  const providers = { ...DEFAULT_PROVIDER_IMPLS, ...deps.providers };
  const mode = deps.mode ?? getAiMode;
  const now = deps.now ?? (() => new Date());
  const getPrompt = deps.loadPrompt ?? loadPrompt;
  const { store } = deps;

  async function record(
    step: AiStep,
    entry: { provider: string; model: string },
    status: UsageStatus,
    extra: Partial<Parameters<AiStore["recordUsage"]>[0]> = {},
    storyId?: string,
  ) {
    await store.recordUsage({
      step,
      provider: entry.provider,
      model: entry.model,
      status,
      cost_usd: 0,
      story_id: storyId,
      created_at: now().toISOString(),
      ...extra,
    });
  }

  /** Кандидаты с учётом режима и закрепления. В режиме mock — только заглушка. */
  async function candidates(step: AiStep): Promise<{ entries: RouteEntry[]; timeoutMs: number }> {
    const m = mode();
    const route = await store.getRoute(step);
    if (m === "mock") return { entries: [{ provider: "mock", model: "mock" }], timeoutMs: route.timeout_ms };
    let entries = route.providers;
    if (m === "gemini" || m === "openai") entries = entries.filter((e) => e.provider === m);
    if (route.pinned_provider) entries = entries.filter((e) => e.provider === route.pinned_provider);
    if (!route.enabled) entries = [];
    return { entries, timeoutMs: route.timeout_ms };
  }

  /** Почему кандидат не подходит прямо сейчас (null — подходит). */
  async function skipReason(entry: RouteEntry, step: AiStep): Promise<string | null> {
    const impl = providers[entry.provider];
    if (!impl) return "неизвестный провайдер";
    if (!impl.isConfigured()) return "нет ключа";
    if (!impl.supports(step)) return "не умеет шаг";
    const settings = await store.getProviderSettings(entry.provider);
    if (!settings.enabled) return "выключен в админке";

    const t = now();
    if (settings.cooldown_minutes > 0) {
      const since = new Date(t.getTime() - settings.cooldown_minutes * 60_000);
      if (await store.hadFailureSince(entry.provider, entry.model, since)) return "остывает после 429/таймаута";
    }
    if (entry.daily_limit !== undefined && entry.daily_limit !== null) {
      const dayStart = startOfDayInTz(QUOTA_TIMEZONE[entry.provider] ?? "UTC", t);
      const used = await store.countCalls(entry.provider, entry.model, dayStart);
      const cap = Math.floor(entry.daily_limit * (entry.threshold ?? DEFAULT_THRESHOLD));
      if (used >= cap) return `квота ${used}/${entry.daily_limit} (порог ${cap})`;
    }
    if (settings.paid) {
      if (settings.daily_budget_usd !== null) {
        const day = await store.spend(entry.provider, startOfDayInTz("UTC", t));
        if (day >= settings.daily_budget_usd) return `бюджет дня $${day.toFixed(2)}`;
      }
      if (settings.monthly_budget_usd !== null) {
        const month = await store.spend(entry.provider, startOfUtcMonth(t));
        if (month >= settings.monthly_budget_usd) return `бюджет месяца $${month.toFixed(2)}`;
      }
    }
    return null;
  }

  async function runWithMeta<S extends AiStep>(step: S, rawInput: AiInput<S>, opts: RunOptions = {}): Promise<RunResult<S>> {
    const input = inputSchemas[step].parse(rawInput) as AiParsedInput<S>;
    const prompt = await getPrompt(step);
    const isMock = mode() === "mock";
    const hash = sha256(`${step}|${prompt.version}|${stableStringify(input)}`);
    const attempts: RunResult<S>["attempts"] = [];

    // Кэш только для настоящих моделей: результат заглушки не должен попасть в прод.
    if (!isMock && !opts.noCache) {
      const cached = await store.cacheGet(hash);
      if (cached) {
        const parsed = outputSchemas[step].safeParse(cached);
        if (parsed.success) {
          await record(step, { provider: "cache", model: "cache" }, "cache_hit", {}, opts.storyId);
          return { output: parsed.data as AiOutput<S>, provider: "cache", model: "cache", cached: true, attempts };
        }
      }
    }

    const { entries, timeoutMs } = await candidates(step);
    for (const [i, entry] of entries.entries()) {
      const reason = await skipReason(entry, step);
      if (reason) {
        attempts.push({ provider: entry.provider, model: entry.model, reason });
        continue;
      }
      let callTimeout = timeoutMs;
      if (opts.deadline !== undefined) {
        const left = opts.deadline - now().getTime() - 1_000;
        if (left < MIN_ATTEMPT_MS) {
          attempts.push({ provider: entry.provider, model: entry.model, reason: "не хватило времени шага" });
          break;
        }
        callTimeout = i === entries.length - 1 ? left : Math.min(timeoutMs, left);
      }
      const impl = providers[entry.provider]!;
      const settings = await store.getProviderSettings(entry.provider);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), callTimeout);
      const started = Date.now();
      try {
        const res = await Promise.race([
          impl.call({ step, input, model: entry.model, systemPrompt: prompt.text, signal: controller.signal }),
          new Promise<never>((_, reject) =>
            controller.signal.addEventListener("abort", () =>
              reject(new ProviderError("timeout", "timeout", entry.provider)),
            ),
          ),
        ]);
        const parsed = outputSchemas[step].safeParse(res.output);
        if (!parsed.success) throw new ProviderError(`неверный формат: ${parsed.error.message.slice(0, 200)}`, "bad_output", entry.provider);

        const cost = estimateCostUsd(entry.model, settings.paid, res.usage);
        await record(
          step,
          entry,
          "ok",
          {
            input_tokens: res.usage.inputTokens,
            output_tokens: res.usage.outputTokens,
            audio_seconds: res.usage.audioSeconds,
            images: res.usage.images,
            cost_usd: cost,
            latency_ms: Date.now() - started,
          },
          opts.storyId,
        );
        if (!isMock) await store.cacheSet(hash, step, entry.provider, entry.model, parsed.data);
        return { output: parsed.data as AiOutput<S>, provider: entry.provider, model: entry.model, cached: false, attempts };
      } catch (e) {
        const err = e instanceof ProviderError ? e : new ProviderError((e as Error).message, "error", entry.provider);
        // Таймаут, урезанный дедлайном шага, — не вина модели: без «остывания» (status error).
        const fullTimeout = err.kind === "timeout" && callTimeout >= timeoutMs;
        const status: UsageStatus =
          err.kind === "rate_limited" ? "rate_limited" : fullTimeout ? "timeout" : "error";
        await record(step, entry, status, { error: err.message.slice(0, 500), latency_ms: Date.now() - started }, opts.storyId);
        attempts.push({ provider: entry.provider, model: entry.model, reason: `${status}: ${err.message.slice(0, 120)}` });
      } finally {
        clearTimeout(timer);
      }
    }
    throw new AiUnavailableError(step, attempts);
  }

  return {
    runWithMeta,
    /** Главный вход: ai.run(step, input) → результат шага. */
    async run<S extends AiStep>(step: S, input: AiInput<S>, opts?: RunOptions): Promise<AiOutput<S>> {
      return (await runWithMeta(step, input, opts)).output;
    },
  };
}

export type AiRouter = ReturnType<typeof createRouter>;
