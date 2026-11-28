// Единая точка чтения окружения. Владелец — Z6.
// Серверные ключи читаются только здесь и только на сервере.

export type AiMode = "mock" | "auto" | "gemini" | "openai";

const AI_MODES: readonly AiMode[] = ["mock", "auto", "gemini", "openai"];

function read(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

/**
 * Режим ИИ:
 * - явно заданный AI_MODE (mock | auto | gemini | openai);
 * - иначе mock, если нет ни одного ключа ИИ, и auto, если ключи есть.
 */
export function getAiMode(): AiMode {
  const raw = read("AI_MODE")?.toLowerCase();
  if (raw && (AI_MODES as readonly string[]).includes(raw)) return raw as AiMode;
  return read("GEMINI_API_KEY") || read("OPENAI_API_KEY") ? "auto" : "mock";
}

export const env = {
  supabaseUrl: () => read("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => read("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: () => read("SUPABASE_SERVICE_ROLE_KEY"),
  geminiApiKey: () => read("GEMINI_API_KEY"),
  openaiApiKey: () => read("OPENAI_API_KEY"),
  /**
   * #94: качество картинок сказки (low | medium | high). По умолчанию low: ~10–20 с вместо ~40 с при лимите
   * шага 45 с — на сцене не уходим в таймаут и готовые акварели. После питча можно вернуть medium в Vercel Env.
   */
  openaiImageQuality: (): "low" | "medium" | "high" => {
    const v = read("OPENAI_IMAGE_QUALITY")?.toLowerCase();
    return v === "medium" || v === "high" ? v : "low";
  },
  adminPin: () => read("ADMIN_PIN"),
  kioskPin: () => read("KIOSK_PIN"),
  telegramBotToken: () => read("TELEGRAM_BOT_TOKEN"),
  telegramChatId: () => read("TELEGRAM_CHAT_ID"),
  /**
   * Публичный адрес ЭТОГО сайта для абсолютных ссылок (QR в книге, /listen, ссылки в /admin и киоске).
   * #211: на превью (VERCEL_ENV=preview) — адрес превью (VERCEL_BRANCH_URL, иначе VERCEL_URL), а не боевой
   * PROD_URL: иначе QR книги, собранной на превью, вёл бы на прод, где такой главы нет. На проде и локально — PROD_URL.
   */
  prodUrl: (): string | undefined => {
    if (getVercelEnv() === "preview") {
      const host = read("VERCEL_BRANCH_URL") ?? read("VERCEL_URL");
      if (host) return host.startsWith("http") ? host : `https://${host}`;
    }
    return read("PROD_URL");
  },
  /** Боевой адрес (PROD_URL) как есть — куда превью шлёт расход ИИ (#211). */
  productionUrl: () => read("PROD_URL")?.replace(/\/+$/, ""),
  /** #211: production | preview | development (VERCEL_ENV; локально и в CI — development). */
  vercelEnv: getVercelEnv,
  /**
   * #211: общий секрет «превью → прод» для расхода ИИ (POST /api/ai/usage — отчёт; #218: бюджет у превью свой).
   * Нет секрета → отправка расхода выключена, прод работает как до #211.
   */
  aiUsageSecret: () => read("AI_USAGE_SECRET"),
  /** Короткий ref проекта Supabase (первые 6 символов поддомена) — для /api/health, не ключ. */
  supabaseRefShort: () => supabaseRef()?.slice(0, 6),
  /**
   * Секрет подписи QR-ссылок /listen (I3). Необязателен: по умолчанию выводится из service-ключа.
   * #67: задан → новые QR подписываются им, проверка принимает и его, и прежний (из service-ключа) — старые QR живы.
   */
  listenSecret: () => read("LISTEN_SECRET"),
  /** #171: секрет таймера Supabase pg_cron → /api/cron/kick (заголовок Authorization: Bearer …). Пусто = ручка закрыта. */
  cronSecret: () => read("CRON_SECRET"),
  aiMode: getAiMode,
};

export type VercelEnv = "production" | "preview" | "development";

export function getVercelEnv(): VercelEnv {
  const v = read("VERCEL_ENV")?.toLowerCase();
  return v === "production" || v === "preview" ? v : "development";
}

/** Ref проекта Supabase — поддомен https://<ref>.supabase.co (для локального Supabase — «local»). */
export function supabaseRef(): string | undefined {
  const url = read("NEXT_PUBLIC_SUPABASE_URL");
  if (!url) return undefined;
  try {
    const host = new URL(url).hostname;
    const m = /^([a-z0-9]+)\.supabase\.(co|in)$/i.exec(host);
    return m?.[1] ? m[1].toLowerCase() : "local";
  } catch {
    return undefined;
  }
}

/** Окружение для ai_usage.env: превью пишет «staging», всё остальное — «prod». */
export function usageEnv(): "prod" | "staging" {
  return getVercelEnv() === "preview" ? "staging" : "prod";
}

/**
 * #211: превью отправляет расход ИИ в прод, только если это превью и заданы AI_USAGE_SECRET и PROD_URL.
 * На проде и локально — всегда false (прод сам себе источник правды).
 */
export function isAiUsageSinkEnabled(): boolean {
  return getVercelEnv() === "preview" && Boolean(read("AI_USAGE_SECRET") && read("PROD_URL"));
}

export function isSupabaseConfigured(): boolean {
  return Boolean(env.supabaseUrl() && env.supabaseServiceRoleKey());
}
