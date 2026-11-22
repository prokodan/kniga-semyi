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
const OPENAI_TEXT: RouteEntry = { provider: "openai", model: "gpt-5-mini" };

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
  completeness: route("completeness", [FLASH_LITE, OPENAI_TEXT], 12_000),
  next_question: route("next_question", [FLASH_LITE, OPENAI_TEXT], 12_000),
  tale: route("tale", [FLASH_LITE, FLASH, OPENAI_TEXT], 40_000),
  illustrate: route("illustrate", [{ provider: "openai", model: "gpt-image-1" }], 60_000),
  persona_reply: route("persona_reply", [FLASH_LITE, OPENAI_TEXT], 20_000),
  // I11: судья на Flash-Lite (квота); обратный перевод — сначала ДРУГАЯ модель (Flash), чем у translate.
  judge: route("judge", [FLASH_LITE, OPENAI_TEXT], 40_000),
  back_translate: route("back_translate", [FLASH, OPENAI_TEXT, FLASH_LITE], 60_000),
};

export const DEFAULT_PROVIDERS: Record<AiProviderName, ProviderSettings> = {
  mock: { provider: "mock", enabled: true, paid: false, daily_budget_usd: null, monthly_budget_usd: null, cooldown_minutes: 0 },
  gemini: { provider: "gemini", enabled: true, paid: false, daily_budget_usd: null, monthly_budget_usd: null, cooldown_minutes: 10 },
  openai: { provider: "openai", enabled: true, paid: true, daily_budget_usd: 2, monthly_budget_usd: 10, cooldown_minutes: 10 },
};

/**
 * Примерные цены, USD (для оценки стоимости в ai_usage и бюджета).
 * Сверить с прайсами провайдеров перед включением платного режима.
 */
export const PRICING: Record<string, { inPerM?: number; outPerM?: number; perAudioMin?: number; perImage?: number }> = {
  "gpt-5-mini": { inPerM: 0.25, outPerM: 2 },
  "gpt-4o-mini": { inPerM: 0.15, outPerM: 0.6 },
  "gpt-4o-transcribe": { perAudioMin: 0.006 },
  "gpt-image-1": { perImage: 0.042 },
};
/** Для неизвестной платной модели считаем с запасом */
export const FALLBACK_PRICING = { inPerM: 1, outPerM: 4, perAudioMin: 0.01, perImage: 0.08 };

/** Бесплатные квоты Gemini сбрасываются в полночь по Тихоокеанскому времени. */
export const QUOTA_TIMEZONE: Record<AiProviderName, string> = {
  mock: "UTC",
  gemini: "America/Los_Angeles",
  openai: "UTC",
};
