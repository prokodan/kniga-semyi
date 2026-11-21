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
  adminPin: () => read("ADMIN_PIN"),
  kioskPin: () => read("KIOSK_PIN"),
  telegramBotToken: () => read("TELEGRAM_BOT_TOKEN"),
  telegramChatId: () => read("TELEGRAM_CHAT_ID"),
  prodUrl: () => read("PROD_URL"),
  /** Секрет подписи QR-ссылок /listen (I3). Необязателен: по умолчанию выводится из service-ключа. */
  listenSecret: () => read("LISTEN_SECRET"),
  aiMode: getAiMode,
};

export function isSupabaseConfigured(): boolean {
  return Boolean(env.supabaseUrl() && env.supabaseServiceRoleKey());
}
