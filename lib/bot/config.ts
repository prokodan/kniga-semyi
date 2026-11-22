// Настройки бота-пульта (I16). Читаются из окружения только на сервере.
// lib/env.ts — общий файл Z6; переменные бота держим здесь, чтобы не трогать контракт.

export type BotConfig = {
  telegramToken?: string;
  /** Группа команды «Книга семьи dev». Строкой: id групп отрицательные и длинные. */
  chatId?: string;
  webhookSecret?: string;
  notifySecret?: string;
  /** Без токена бот работает «только чтение» (публичный репозиторий). */
  githubToken?: string;
  repo: string;
  prodUrl?: string;
  supabaseUrl?: string;
  vercelUrl: string;
  milestone: string;
  /** Заморозка фич и питч — для обратного отсчёта. */
  freezeAt: Date;
  pitchAt: Date;
};

function read(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

export function getBotConfig(): BotConfig {
  return {
    telegramToken: read("TELEGRAM_BOT_TOKEN"),
    chatId: read("TELEGRAM_CHAT_ID"),
    webhookSecret: read("TELEGRAM_WEBHOOK_SECRET"),
    notifySecret: read("BOT_NOTIFY_SECRET"),
    githubToken: read("GITHUB_TOKEN"),
    repo: read("GITHUB_REPO") ?? "prokodan/kniga-semyi",
    prodUrl: read("PROD_URL")?.replace(/\/+$/, ""),
    supabaseUrl: read("NEXT_PUBLIC_SUPABASE_URL"),
    vercelUrl: read("BOT_VERCEL_URL") ?? "https://vercel.com/dashboard",
    milestone: read("BOT_MILESTONE") ?? "MLP 27.11",
    freezeAt: new Date("2026-11-25T14:00:00+05:00"),
    pitchAt: new Date("2026-11-27T10:00:00+05:00"),
  };
}

/** Сравнение секретов без утечки по времени. */
export function safeEqual(a: string | null | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}
