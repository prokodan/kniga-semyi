import "server-only";
import { cookies, headers } from "next/headers";
import { env } from "@/lib/env";
import { ADMIN_COOKIE, ADMIN_SESSION_HOURS, makeSessionToken, verifySessionToken } from "./pin";

export function isAdminConfigured(): boolean {
  return Boolean(env.adminPin());
}

export async function isAdmin(): Promise<boolean> {
  const jar = await cookies();
  return verifySessionToken(env.adminPin(), jar.get(ADMIN_COOKIE)?.value);
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

export async function startAdminSession(): Promise<void> {
  const pin = env.adminPin();
  if (!pin) return;
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, makeSessionToken(pin), {
    httpOnly: true,
    secure: await secureCookie(),
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_SESSION_HOURS * 3600,
  });
}

export async function endAdminSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(ADMIN_COOKIE);
}
