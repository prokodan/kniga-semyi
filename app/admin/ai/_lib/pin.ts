// Вход в админку по ADMIN_PIN: проверка PIN и подписанная cookie (без хранения PIN в cookie).
// Подпись = HMAC-SHA256(ключ = ADMIN_PIN, "admin|<срок>"). Смена ADMIN_PIN разлогинивает всех.
import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "ks_admin";
export const ADMIN_SESSION_HOURS = 12;

function sign(pin: string, exp: number): string {
  return createHmac("sha256", pin).update(`admin|${exp}`).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function pinMatches(pin: string | undefined, input: string): boolean {
  if (!pin) return false;
  return safeEqual(pin, input.trim());
}

export function makeSessionToken(pin: string, now: Date = new Date()): string {
  const exp = now.getTime() + ADMIN_SESSION_HOURS * 3_600_000;
  return `${exp}.${sign(pin, exp)}`;
}

export function verifySessionToken(pin: string | undefined, token: string | undefined, now: Date = new Date()): boolean {
  if (!pin || !token) return false;
  const [expRaw, sig] = token.split(".");
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || !sig || exp < now.getTime()) return false;
  return safeEqual(sig, sign(pin, exp));
}
