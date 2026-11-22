import "server-only";
// Сессия планшета киоска: cookie по PIN до конца дня + текущий волонтёр.
import { cookies } from "next/headers";
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

const cookieOpts = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  expires: kioskDayEnd(),
});

export async function startKioskSession(): Promise<void> {
  const pin = env.kioskPin();
  if (!pin) return;
  const jar = await cookies();
  jar.set(KIOSK_COOKIE, makeKioskToken(pin), cookieOpts());
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
  jar.set(KIOSK_VOLUNTEER_COOKIE, id, cookieOpts());
}
