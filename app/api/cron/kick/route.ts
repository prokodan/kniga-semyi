import { NextResponse } from "next/server";
import { env, isSupabaseConfigured } from "@/lib/env";
import { runKick } from "@/lib/pipeline/kick";
import { cronAuthorized } from "@/lib/pipeline/kick-rule";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// #171: POST /api/cron/kick — подстраховка конвейера глав (как workflow kick-stuck). Вызывает Supabase pg_cron
// раз в 5 мин через pg_net (миграция 20261125200000_cron_kick.sql), секрет — «Authorization: Bearer CRON_SECRET».
// ?dry=1 — только показать, что сделали бы. Ответ — счётчики и строки с началами id, без токенов и текстов.
async function handle(req: Request) {
  const secret = env.cronSecret();
  if (!secret) return json({ error: "not_configured", message: "CRON_SECRET не задан" }, 503);
  if (!cronAuthorized(req.headers.get("authorization"), secret)) return json({ error: "forbidden" }, 401);
  if (!isSupabaseConfigured()) return json({ error: "not_configured", message: "Supabase не настроен" }, 503);
  const started = Date.now();
  try {
    const dryRun = new URL(req.url).searchParams.get("dry") === "1";
    const report = await runKick(new URL(req.url).origin, { dryRun });
    if (report.found) console.log(`[kick] ${report.lines.join(" | ")}`);
    return json({ ok: true, dry_run: dryRun, ...report, ms: Date.now() - started });
  } catch (e) {
    console.error("[kick]", (e as Error).message);
    return json({ error: "internal", message: (e as Error).message.slice(0, 200) }, 500);
  }
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

export const POST = handle;
export const GET = handle;
