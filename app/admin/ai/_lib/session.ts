import "server-only";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { ADMIN_COOKIE, ADMIN_SESSION_HOURS, makeSessionToken, verifySessionToken } from "./pin";

export function isAdminConfigured(): boolean {
  return Boolean(env.adminPin());
}

export async function isAdmin(): Promise<boolean> {
  const jar = await cookies();
  return verifySessionToken(env.adminPin(), jar.get(ADMIN_COOKIE)?.value);
}

export async function startAdminSession(): Promise<void> {
  const pin = env.adminPin();
  if (!pin) return;
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, makeSessionToken(pin), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_SESSION_HOURS * 3600,
  });
}

export async function endAdminSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(ADMIN_COOKIE);
}
