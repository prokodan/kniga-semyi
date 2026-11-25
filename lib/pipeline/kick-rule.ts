// #171: правила подстраховки конвейера (как scripts/kick-stuck.mjs) — чистые функции, без server-only, для тестов.
// Таймер — Supabase pg_cron раз в 5 мин → /api/cron/kick (GitHub cron «*/10» по факту запускался раз в 8–12 ч).
import { createHash, timingSafeEqual } from "node:crypto";
import type { StoryStatus } from "@/lib/types";

/** Шаг не закончен */
export const KICK_ACTIVE: StoryStatus[] = ["uploaded", "transcribing", "editing", "translating"];
/** Стоит без изменений дольше — перезапустить */
export const KICK_STALE_MS = 5 * 60_000;
/** Попыток таймера, потом failed с понятной причиной (семья видит «Перезапустить сборку») */
export const KICK_MAX_ATTEMPTS = 3;
/** #98: поздние попытки для failed по перегрузке ИИ — ещё столько, не чаще раза в час, первые 72 ч после записи */
export const KICK_LATE_ATTEMPTS = 6;
export const KICK_LATE_EVERY_MS = 60 * 60_000;
export const KICK_LATE_WINDOW_MS = 72 * 3600_000;
/** Начало текста ошибки, которую ставит подстраховка (по нему находятся поздние попытки) */
export const KICK_FAILED = "Глава не собралась за";
/** Не больше историй за один запуск: вызовы /process идут параллельно, а у функции Vercel 60 с */
export const KICK_MAX_PER_RUN = 8;
export const KICK_LATE_MAX_PER_RUN = 4;
/** Сколько ждать ответа /process (шаг ≤ 48 с); дальше шаг идёт без нас, а ручка успевает ответить в 60 с */
export const KICK_WAIT_MS = 45_000;

const LABEL: Partial<Record<StoryStatus, string>> = {
  uploaded: "расшифровка",
  transcribing: "расшифровка",
  editing: "редактура",
  translating: "перевод",
};

export interface KickCandidate {
  id: string;
  family_id: string;
  status: StoryStatus;
  kick_attempts: number | null;
  late?: boolean;
}

export type KickAction = { kind: "fail"; tries: number } | { kind: "kick"; tries: number; of: number };

/** Что делать с застрявшей историей: исчерпала попытки → failed; иначе — перезапуск. */
export function kickAction(s: KickCandidate): KickAction {
  const tries = s.kick_attempts ?? 0;
  if (!s.late && tries >= KICK_MAX_ATTEMPTS) return { kind: "fail", tries };
  return { kind: "kick", tries, of: KICK_MAX_ATTEMPTS + (s.late ? KICK_LATE_ATTEMPTS : 0) };
}

/** Понятная причина по последней неудачной попытке ИИ этой истории. */
export function kickCause(last: { status: string; error: string | null } | null): string {
  if (!last) return "шаг не успел запуститься";
  if (last.status === "timeout") return "модель ИИ не ответила вовремя";
  if (last.status === "rate_limited" || /HTTP 503|429|high demand/i.test(last.error ?? "")) return "модели ИИ были перегружены";
  return "техническая ошибка ИИ";
}

function plural(n: number): string {
  const d = n % 10;
  return d >= 2 && d <= 4 && (n < 10 || n > 20) ? "ки" : "ок";
}

/** Текст ошибки для семьи (начинается с KICK_FAILED — по нему потом поздние попытки). */
export function kickFailedMessage(status: StoryStatus, tries: number, cause: string): string {
  return `${KICK_FAILED} ${tries} попыт${plural(tries)} (шаг «${LABEL[status] ?? status}»): ${cause}. Запись сохранена — нажмите «Перезапустить сборку».`;
}

/**
 * Проверка секрета таймера в постоянном времени. Принимает «Authorization: Bearer <секрет>».
 * Сравниваем sha256 обоих значений: одинаковая длина → timingSafeEqual не выдаёт длину секрета.
 * Нет секрета на сервере → всегда false (ручка закрыта).
 */
export function cronAuthorized(authorization: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  const m = /^Bearer\s+(.+)$/i.exec(authorization?.trim() ?? "");
  const given = createHash("sha256").update(m?.[1] ?? "").digest();
  const expected = createHash("sha256").update(secret).digest();
  return timingSafeEqual(given, expected) && Boolean(m);
}
