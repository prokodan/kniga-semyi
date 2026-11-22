// Киоск АКНЦ (I4): PIN волонтёра → подписанная cookie до конца дня по Алматы (без хранения PIN в cookie).
// Подпись = HMAC-SHA256(ключ = KIOSK_PIN, "kiosk|<срок>"). Смена KIOSK_PIN разлогинивает все планшеты.
// Чистые функции без next/* — их проверяют тесты.
import { createHmac, timingSafeEqual } from "node:crypto";

export const KIOSK_COOKIE = "ks_kiosk";
/** Текущий волонтёр планшета (id из kiosk_volunteers). Не секрет: права даёт только KIOSK_COOKIE. */
export const KIOSK_VOLUNTEER_COOKIE = "ks_kiosk_vol";

/** Алматы: UTC+5 круглый год (с 01.03.2024 весь Казахстан). */
const TZ_OFFSET_MS = 5 * 3_600_000;
const DAY_MS = 24 * 3_600_000;

/** Начало сегодняшнего дня по Алматы (момент UTC). */
export function kioskDayStart(now: Date = new Date()): Date {
  const local = now.getTime() + TZ_OFFSET_MS;
  return new Date(local - (local % DAY_MS) - TZ_OFFSET_MS);
}

/** Полночь следующего дня по Алматы — до неё живёт вход по PIN. */
export function kioskDayEnd(now: Date = new Date()): Date {
  return new Date(kioskDayStart(now).getTime() + DAY_MS);
}

function sign(pin: string, exp: number): string {
  return createHmac("sha256", pin).update(`kiosk|${exp}`).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** PIN совпал. Не задан KIOSK_PIN — вход закрыт. */
export function kioskPinMatches(pin: string | undefined, input: string): boolean {
  if (!pin) return false;
  return safeEqual(pin, input.trim());
}

export function makeKioskToken(pin: string, now: Date = new Date()): string {
  const exp = kioskDayEnd(now).getTime();
  return `${exp}.${sign(pin, exp)}`;
}

export function verifyKioskToken(pin: string | undefined, token: string | undefined, now: Date = new Date()): boolean {
  if (!pin || !token) return false;
  const [expRaw, sig] = token.split(".");
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || !sig || exp <= now.getTime()) return false;
  return safeEqual(sig, sign(pin, exp));
}
