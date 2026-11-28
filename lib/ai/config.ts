// Значения роутера по умолчанию. Источник правды в проде — таблицы ai_routes / ai_providers
// (меняются в админке /admin/ai без деплоя). Эти значения используются, если строки в базе нет
// или база не настроена, и должны совпадать с сидом в supabase/migrations/20261122000000_init.sql.
import type { AiProviderName, AiStep } from "./types";

export interface RouteEntry {
  provider: AiProviderName;
  model: string;
  /** Бесплатная квота запросов в сутки для этой модели (нет — без лимита) */
  daily_limit?: number;
  /** Доля квоты, после которой роутер переходит к следующему (0.9 = 90%) */
  threshold?: number;
}

export interface Route {
  step: AiStep;
  providers: RouteEntry[];
  pinned_provider: AiProviderName | null;
  timeout_ms: number;
  enabled: boolean;
}

export interface ProviderSettings {
  provider: AiProviderName;
  enabled: boolean;
  paid: boolean;
  daily_budget_usd: number | null;
  monthly_budget_usd: number | null;
  cooldown_minutes: number;
}

export const DEFAULT_THRESHOLD = 0.9;

const FLASH_LITE: RouteEntry = { provider: "gemini", model: "gemini-2.5-flash-lite", daily_limit: 500, threshold: 0.9 };
const FLASH: RouteEntry = { provider: "gemini", model: "gemini-2.5-flash", daily_limit: 20, threshold: 0.9 };
// #105: gpt-5-mini OpenAI помечает устаревающим → резерв gpt-5.4-mini (быстрее, дороже: $0.75 / $4.50 за 1M)
const OPENAI_TEXT: RouteEntry = { provider: "openai", model: "gpt-5.4-mini" };

const route = (step: AiStep, providers: RouteEntry[], timeout_ms: number): Route => ({
  step,
  providers,
  pinned_provider: null,
  timeout_ms,
  enabled: true,
});

export const DEFAULT_ROUTES: Record<AiStep, Route> = {
  transcribe: route("transcribe", [FLASH_LITE, FLASH, { provider: "openai", model: "gpt-4o-transcribe" }], 45_000),
  edit: route("edit", [FLASH_LITE, FLASH, OPENAI_TEXT], 30_000),
  translate: route("translate", [FLASH_LITE, FLASH, OPENAI_TEXT], 30_000),
  // #178: ответ интервью ждёт эти два шага — второй моделью Flash (1–2 с), не gpt (медиана 8 с); таймаут 7 с вместо 12
  completeness: route("completeness", [FLASH_LITE, FLASH, OPENAI_TEXT], 7_000),
  next_question: route("next_question", [FLASH_LITE, FLASH, OPENAI_TEXT], 7_000),
  tale: route("tale", [FLASH_LITE, FLASH, OPENAI_TEXT], 40_000),
  // gpt-image-1 OpenAI снял («The model 'gpt-image-1' does not exist», seed-demo 23.11) → gpt-image-2, резерв gpt-image-1.5.
  // 45 с < лимита функции 60 с: если художник не успел, сказка успевает поставить картинку из набора.
  illustrate: route("illustrate", [{ provider: "openai", model: "gpt-image-2" }, { provider: "openai", model: "gpt-image-1.5" }], 45_000),
  persona_reply: route("persona_reply", [FLASH_LITE, OPENAI_TEXT], 20_000),
  // I11: судья на Flash-Lite (квота); обратный перевод — сначала ДРУГАЯ модель (Flash), чем у translate.
  judge: route("judge", [FLASH_LITE, OPENAI_TEXT], 40_000),
  back_translate: route("back_translate", [FLASH, OPENAI_TEXT, FLASH_LITE], 60_000),
  // #352: банк проверок — самая сильная модель OpenAI, которую видит ключ (gpt-5.5 → 404 → gpt-5.4 → gpt-5.4-mini).
  // Только /admin/quality на staging; 50 с — чтобы «Сгенерировать N» уложилась в лимит функции 60 с.
  quality_generate: route(
    "quality_generate",
    [{ provider: "openai", model: "gpt-5.5" }, { provider: "openai", model: "gpt-5.4" }, OPENAI_TEXT],
    50_000,
  ),
};

export const DEFAULT_PROVIDERS: Record<AiProviderName, ProviderSettings> = {
  mock: { provider: "mock", enabled: true, paid: false, daily_budget_usd: null, monthly_budget_usd: null, cooldown_minutes: 0 },
  gemini: { provider: "gemini", enabled: true, paid: false, daily_budget_usd: null, monthly_budget_usd: null, cooldown_minutes: 10 },
  openai: { provider: "openai", enabled: true, paid: true, daily_budget_usd: 2, monthly_budget_usd: 10, cooldown_minutes: 10 },
};

export interface Price {
  inPerM?: number;
  outPerM?: number;
  perAudioMin?: number;
  perImage?: number;
}

/**
 * Цены, USD (для оценки стоимости в ai_usage и бюджета роутера). Считаются только у платных провайдеров (paid).
 *
 * Gemini (#194) — официальная страница Google, Standard, Paid Tier, за 1M токенов, по состоянию на 27.11.2026:
 * https://ai.google.dev/gemini-api/docs/pricing
 *   gemini-3.5-flash-lite: вход $0.30 (текст / картинка / видео / аудио — одна цена), выход $2.50 (вместе с thinking);
 *   gemini-3.6-flash: вход $0.75, выход $3.75 по 31.12.2026 (акция), с 01.01.2027 — $1.50 / $7.50 (PRICING_FROM).
 * Аудио Gemini считается токенами во входе (promptTokenCount), поэтому perAudioMin у Gemini не задаём — иначе двойной счёт.
 * Выход Gemini = candidates + thoughts (lib/ai/providers/gemini.ts → outputTokens).
 */
export const PRICING: Record<string, Price> = {
  "gemini-3.5-flash-lite": { inPerM: 0.3, outPerM: 2.5 },
  "gemini-3.6-flash": { inPerM: 0.75, outPerM: 3.75 },
  // #352: OpenAI Standard, за 1M токенов (openai.com/api/pricing, 28.11.2026) — только quality_generate
  "gpt-5.5": { inPerM: 5, outPerM: 30 },
  "gpt-5.4": { inPerM: 2.5, outPerM: 15 },
  "gpt-5.4-mini": { inPerM: 0.75, outPerM: 4.5 },
  "gpt-5-mini": { inPerM: 0.25, outPerM: 2 },
  "gpt-4o-mini": { inPerM: 0.15, outPerM: 0.6 },
  "gpt-4o-transcribe": { perAudioMin: 0.006 },
  "gpt-image-2": { perImage: 0.05 }, // оценка для бюджета: 1024², quality medium
  "gpt-image-1.5": { perImage: 0.05 },
};

/** Плановые смены цен: с даты (UTC, включительно) действует новая цена модели. */
export const PRICING_FROM: { from: string; model: string; price: Price }[] = [
  // Google: акционная цена 3.6 Flash — по 31.12.2026
  { from: "2027-01-01", model: "gemini-3.6-flash", price: { inPerM: 1.5, outPerM: 7.5 } },
];

/** Цена модели на момент `at` (последняя наступившая смена из PRICING_FROM, иначе PRICING, иначе FALLBACK). */
export function priceOf(model: string, at: Date = new Date()): Price {
  const changes = PRICING_FROM.filter((c) => c.model === model && Date.parse(`${c.from}T00:00:00Z`) <= at.getTime()).sort(
    (a, b) => a.from.localeCompare(b.from),
  );
  return changes.at(-1)?.price ?? PRICING[model] ?? FALLBACK_PRICING;
}

/** Для неизвестной платной модели считаем с запасом */
export const FALLBACK_PRICING: Price = { inPerM: 1, outPerM: 4, perAudioMin: 0.01, perImage: 0.08 };

/** Бесплатные квоты Gemini сбрасываются в полночь по Тихоокеанскому времени. */
export const QUOTA_TIMEZONE: Record<AiProviderName, string> = {
  mock: "UTC",
  gemini: "America/Los_Angeles",
  openai: "UTC",
};
