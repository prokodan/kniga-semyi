import { NextResponse } from "next/server";
import { digestNow } from "@/app/admin/quality/findings/_lib/store";
import { env } from "@/lib/env";
import { flag } from "@/lib/flags";
import { cronAuthorized } from "@/lib/pipeline/kick-rule";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// #354: POST /api/cron/quality-digest — разбор новых отзывов проверяющих (docs/v2/QUALITY_LOOP.md §5.2).
// Вызывает Supabase pg_cron 'quality-digest' раз в час (миграция 20261128230000), секрет — «Authorization: Bearer
// CRON_SECRET» (тот же, что у kick). Флаг quality_loop выключен (прод) — 200 и ничего не делаем. В ответе — только числа.
async function handle(req: Request) {
  const secret = env.cronSecret();
  if (!secret) return json({ error: "not_configured", message: "CRON_SECRET не задан" }, 503);
  if (!cronAuthorized(req.headers.get("authorization"), secret)) return json({ error: "forbidden" }, 401);
  if (!flag("quality_loop")) return json({ ok: true, skipped: "flag quality_loop off" });
  const started = Date.now();
  try {
    const r = await digestNow("cron", { deadline: started + 52_000 });
    if (!r) return json({ ok: true, skipped: "flag quality_loop off" });
    console.log(`[quality-digest] ${r.status}: текстов ${r.itemsAnalyzed}/${r.itemsSeen}, новых ${r.findingsNew}, слито ${r.findingsMerged}, $${r.costUsd.toFixed(4)}`);
    return json({ ok: true, ...r, ms: Date.now() - started });
  } catch (e) {
    console.error("[quality-digest]", (e as Error).message.slice(0, 200));
    return json({ error: "internal", message: (e as Error).message.slice(0, 200) }, 500);
  }
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

export const POST = handle;
export const GET = handle;
