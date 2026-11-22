import "server-only";
// #56: лимит неверных вводов PIN — 5 за 10 минут с одного IP (вход /admin/ai, /admin и /center — один ADMIN_PIN).
// Считаем только неверные попытки; верный PIN очищает счётчик этого IP. Хранилище — pin_attempts
// (общая для всех инстансов Vercel) или память процесса без Supabase. IP храним только хэшем.
import { createHash } from "node:crypto";
import { getDbOrNull } from "@/lib/db";
import { env } from "@/lib/env";

export const PIN_MAX_FAILS = 5;
export const PIN_WINDOW_MS = 10 * 60_000;

export type PinScope = "admin";

export interface PinLimit {
  /** false — вход закрыт до retryAt */
  allowed: boolean;
  /** сколько неверных попыток осталось в окне */
  left: number;
  /** когда снова можно (самая старая неудача окна + 10 мин) */
  retryAt: Date | null;
}

/** Чистая логика окна: времена неудач (мс) → можно ли пробовать ещё. */
export function limitFrom(fails: number[], now: number, max = PIN_MAX_FAILS, windowMs = PIN_WINDOW_MS): PinLimit {
  const recent = fails.filter((t) => now - t < windowMs).sort((a, b) => a - b);
  if (recent.length < max) return { allowed: true, left: max - recent.length, retryAt: null };
  // закрыто, пока в окне остаётся max неудач: до выхода из окна (max-й с конца)
  const unlock = recent[recent.length - max]! + windowMs;
  return { allowed: false, left: 0, retryAt: new Date(unlock) };
}

/** Понятное сообщение: «Слишком много попыток. Попробуйте через 7 мин.» */
export function lockedMessage(limit: PinLimit, now: Date = new Date()): string {
  const min = limit.retryAt ? Math.max(1, Math.ceil((limit.retryAt.getTime() - now.getTime()) / 60_000)) : 10;
  return `Слишком много неверных попыток. Вход закрыт на ${min} мин — попробуйте позже.`;
}

/** Сообщение после неверного PIN: сколько попыток осталось (без подсказок о самом PIN). */
export function wrongMessage(limit: PinLimit): string {
  if (!limit.allowed) return lockedMessage(limit);
  if (limit.left <= 2) return `PIN не подошёл. Осталось попыток: ${limit.left}, потом вход закроется на 10 минут.`;
  return "PIN не подошёл";
}

/** IP клиента за прокси Vercel: первый адрес x-forwarded-for, иначе x-real-ip. */
export function clientIp(h: Pick<Headers, "get">): string {
  const xff = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || h.get("x-real-ip")?.trim() || "unknown";
}

function hashIp(ip: string): string {
  return createHash("sha256").update(`pin:${env.adminPin() ?? ""}:${ip}`).digest("hex").slice(0, 32);
}

const g = globalThis as { __pinFails?: Map<string, number[]> };
const memory = () => (g.__pinFails ??= new Map<string, number[]>());

async function failsSince(scope: PinScope, ipHash: string, since: Date): Promise<number[]> {
  const db = getDbOrNull();
  if (!db) return (memory().get(`${scope}|${ipHash}`) ?? []).filter((t) => t >= since.getTime());
  const { data, error } = await db
    .from("pin_attempts")
    .select("created_at")
    .eq("scope", scope)
    .eq("ip_hash", ipHash)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(PIN_MAX_FAILS * 4);
  if (error) {
    // Таблицы ещё нет (миграция не применена) — не запираем вход, работает пауза.
    console.error("[pin] попытки:", error.message);
    return [];
  }
  return (data ?? []).map((r) => Date.parse((r as { created_at: string }).created_at));
}

/** Можно ли сейчас проверять PIN с этого IP. */
export async function checkPinLimit(scope: PinScope, ip: string, now: Date = new Date()): Promise<PinLimit> {
  const fails = await failsSince(scope, hashIp(ip), new Date(now.getTime() - PIN_WINDOW_MS));
  return limitFrom(fails, now.getTime());
}

/** Записать неверную попытку и вернуть, что осталось. */
export async function recordPinFail(scope: PinScope, ip: string, now: Date = new Date()): Promise<PinLimit> {
  const ipHash = hashIp(ip);
  const db = getDbOrNull();
  if (!db) {
    const key = `${scope}|${ipHash}`;
    const list = (memory().get(key) ?? []).filter((t) => now.getTime() - t < PIN_WINDOW_MS);
    list.push(now.getTime());
    memory().set(key, list);
  } else {
    const { error } = await db.from("pin_attempts").insert({ scope, ip_hash: ipHash, created_at: now.toISOString() });
    if (error) console.error("[pin] запись попытки:", error.message);
    // уборка старых строк (дёшево, по индексу)
    void db
      .from("pin_attempts")
      .delete()
      .lt("created_at", new Date(now.getTime() - 24 * 3_600_000).toISOString())
      .then(({ error: e }) => e && console.error("[pin] уборка:", e.message));
  }
  return checkPinLimit(scope, ip, now);
}

/** Верный PIN — счётчик этого IP обнуляется. */
export async function clearPinFails(scope: PinScope, ip: string): Promise<void> {
  const ipHash = hashIp(ip);
  const db = getDbOrNull();
  if (!db) {
    memory().delete(`${scope}|${ipHash}`);
    return;
  }
  const { error } = await db.from("pin_attempts").delete().eq("scope", scope).eq("ip_hash", ipHash);
  if (error) console.error("[pin] сброс:", error.message);
}

export type AdminPinResult = { ok: true } | { ok: false; status: 401 | 429; message: string; left: number };

/**
 * Проверка ADMIN_PIN с лимитом попыток — одна для /admin, /admin/ai и /center.
 * Закрыто → 429 сразу (PIN даже не сверяем); неверный → пауза 0,8 с, запись, 401 (или 429, если это была 5-я).
 */
export async function tryAdminPin(input: string, ip: string, matches: (input: string) => boolean): Promise<AdminPinResult> {
  const limit = await checkPinLimit("admin", ip);
  if (!limit.allowed) return { ok: false, status: 429, message: lockedMessage(limit), left: 0 };
  if (!matches(input)) {
    await new Promise((r) => setTimeout(r, 800));
    const after = await recordPinFail("admin", ip);
    return { ok: false, status: after.allowed ? 401 : 429, message: wrongMessage(after), left: after.left };
  }
  await clearPinFails("admin", ip);
  return { ok: true };
}
