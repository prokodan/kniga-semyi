import "server-only";
// Сессия планшета киоска: cookie по PIN до конца дня + текущий волонтёр.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { KIOSK_COOKIE, KIOSK_VOLUNTEER_COOKIE, kioskDayEnd, makeKioskToken, verifyKioskToken } from "./pin";

export function isKioskConfigured(): boolean {
  return Boolean(env.kioskPin());
}

export async function isKiosk(): Promise<boolean> {
  const jar = await cookies();
  return verifyKioskToken(env.kioskPin(), jar.get(KIOSK_COOKIE)?.value);
}

/** Для страниц киоска: без входа — на экран PIN. */
export async function requireKiosk(): Promise<void> {
  if (!(await isKiosk())) redirect("/kiosk");
}

/** Secure — только для HTTPS (Vercel всегда https). На http://localhost (next start, e2e, телефон по Wi-Fi) Safari
 *  не сохраняет Secure-cookie, и вход по PIN «не держится». */
async function secureCookie(): Promise<boolean> {
  if (process.env.NODE_ENV !== "production") return false;
  const h = await headers();
  const proto = (h.get("x-forwarded-proto") ?? "").split(",")[0]!.trim();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  return proto !== "http" && !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

const cookieOpts = async () => ({
  httpOnly: true,
  secure: await secureCookie(),
  sameSite: "lax" as const,
  path: "/",
  expires: kioskDayEnd(),
});

export async function startKioskSession(): Promise<void> {
  const pin = env.kioskPin();
  if (!pin) return;
  const jar = await cookies();
  jar.set(KIOSK_COOKIE, makeKioskToken(pin), await cookieOpts());
}

export async function endKioskSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(KIOSK_COOKIE);
  jar.delete(KIOSK_VOLUNTEER_COOKIE);
}

export async function currentVolunteerId(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(KIOSK_VOLUNTEER_COOKIE)?.value ?? null;
}

export async function setCurrentVolunteer(id: string): Promise<void> {
  const jar = await cookies();
  jar.set(KIOSK_VOLUNTEER_COOKIE, id, await cookieOpts());
}
