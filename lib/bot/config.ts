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
  /** Проект Vercel (https://vercel.com/<команда>/<проект>) — из него же ссылка на Environment Variables. */
  vercelUrl: string;
  /** Supabase staging (#211), если задан — ссылка в «Сервисах». */
  stagingSupabaseUrl?: string;
  /** Адрес staging / превью вручную (#211); иначе — последнее превью из GitHub Deployments. */
  stagingUrl?: string;
  /** Вехи для обратного отсчёта — из BOT_MILESTONES, не из кода. */
  milestones: Milestone[];
};

export type Milestone = { title: string; at: Date };

/** По умолчанию (решение Данила 27.11): видео полуфинала до 27.11 23:59, финал 6.12. */
export const DEFAULT_MILESTONES = "2026-11-27T23:59+05:00=Видео полуфинала;2026-12-06T10:00+05:00=Финал Startup-Nunchi";

/**
 * «ISO=название;ISO=название» → вехи по времени. Плохие куски пропускаются (бот не падает из-за опечатки в Env).
 * Пример: BOT_MILESTONES="2026-12-06T10:00+05:00=Финал;2027-01-15T00:00+05:00=v2: языки".
 */
export function parseMilestones(raw: string | undefined): Milestone[] {
  const list = (raw ?? DEFAULT_MILESTONES)
    .split(/[;\n]/)
    .map((part) => {
      const i = part.indexOf("=");
      if (i < 0) return null;
      const at = new Date(part.slice(0, i).trim());
      const title = part.slice(i + 1).trim();
      return Number.isNaN(at.getTime()) || !title ? null : { title, at };
    })
    .filter((m): m is Milestone => m !== null)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  return list.length || raw === undefined ? list : parseMilestones(undefined);
}

/** Ближайшая будущая веха; если все прошли — null. */
export function nextMilestone(list: Milestone[], now: Date): Milestone | null {
  return list.find((m) => m.at.getTime() > now.getTime()) ?? null;
}

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
    vercelUrl: (read("BOT_VERCEL_URL") ?? "https://vercel.com/dashboard").replace(/\/+$/, ""),
    stagingSupabaseUrl: read("BOT_STAGING_SUPABASE_URL") ?? read("STAGING_SUPABASE_URL"),
    stagingUrl: read("BOT_STAGING_URL")?.replace(/\/+$/, ""),
    milestones: parseMilestones(read("BOT_MILESTONES")),
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
