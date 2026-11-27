import { NextResponse } from "next/server";
import { getBot } from "@/lib/bot";
import { env } from "@/lib/env";
import { cronAuthorized } from "@/lib/pipeline/kick-rule";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// #212: POST /api/cron/digest — сводка бота в группу. Вызывает Supabase pg_cron каждый день в 04:00 UTC = 09:00 Алматы
// (миграция 20261127090000_bot_digest.sql), секрет — «Authorization: Bearer CRON_SECRET» (тот же, что у kick).
// ?dry=1 — собрать текст и вернуть его, не отправляя. Настройки 🔔 (выключена сводка, тихие часы) уважаются.
// В тексте сводки нет токенов и имён семей — только числа и ссылки на GitHub.
async function handle(req: Request) {
  const secret = env.cronSecret();
  if (!secret) return json({ error: "not_configured", message: "CRON_SECRET не задан" }, 503);
  if (!cronAuthorized(req.headers.get("authorization"), secret)) return json({ error: "forbidden" }, 401);
  const built = getBot();
  if (!built) return json({ error: "not_configured", message: "TELEGRAM_BOT_TOKEN не задан" }, 503);
  const started = Date.now();
  try {
    if (new URL(req.url).searchParams.get("dry") === "1") {
      const text = await built.bot.digestText();
      return json({ ok: true, dry_run: true, text, ms: Date.now() - started });
    }
    const result = await built.bot.handleNotify({ event: "digest" });
    console.log(`[digest] delivered=${result.delivered}${result.reason ? ` (${result.reason})` : ""}`);
    return json({ ok: true, ...result, ms: Date.now() - started });
  } catch (e) {
    console.error("[digest]", (e as Error).message.slice(0, 200));
    return json({ error: "internal", message: (e as Error).message.slice(0, 200) }, 500);
  }
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

export const POST = handle;
export const GET = handle;
