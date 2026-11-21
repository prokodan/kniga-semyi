import { NextResponse } from "next/server";
import { getDbOrNull } from "@/lib/db";
import { getAiMode } from "@/lib/env";

export const dynamic = "force-dynamic";

// Проверка живости для smoke и Vercel. 200 + status "ok", если приложение живо и база
// отвечает (или ещё не настроена — тогда db: "not_configured"). 503 + "degraded", если база упала.
export async function GET() {
  const started = Date.now();
  const db = getDbOrNull();
  let dbStatus: "ok" | "not_configured" | "error" = "not_configured";
  let dbError: string | undefined;

  if (db) {
    const { error } = await db.from("families").select("id", { count: "exact", head: true });
    dbStatus = error ? "error" : "ok";
    dbError = error?.message;
  }

  const ok = dbStatus !== "error";
  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      db: dbStatus,
      ...(dbError ? { db_error: dbError } : {}),
      ai_mode: getAiMode(),
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
      region: process.env.VERCEL_REGION ?? "local",
      latency_ms: Date.now() - started,
    },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
