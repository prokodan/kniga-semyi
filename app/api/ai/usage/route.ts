import { NextResponse } from "next/server";
import { AI_USAGE_HEADER, remoteUsageSchema, toProdRow, usageSecretOk } from "@/lib/ai/shared-usage";
import { getDbOrNull } from "@/lib/db";
import { env, supabaseRef } from "@/lib/env";

export const dynamic = "force-dynamic";

// #211: POST /api/ai/usage — превью (staging) присылает строку расхода ИИ, прод сохраняет её с env='staging'.
// Заголовок x-ai-usage-secret = AI_USAGE_SECRET. Без секрета на сервере ручка закрыта (503) — прод как до #211.
// Принимает только прод: на превью ручка отвечает 404 (превью само отправитель).
export async function POST(req: Request) {
  if (env.vercelEnv() === "preview") return json({ error: "not_found" }, 404);
  const secret = env.aiUsageSecret();
  if (!secret) return json({ error: "not_configured" }, 503);
  if (!usageSecretOk(req.headers.get(AI_USAGE_HEADER), secret)) return json({ error: "forbidden" }, 401);
  const db = getDbOrNull();
  if (!db) return json({ error: "not_configured", message: "Supabase не настроен" }, 503);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const parsed = remoteUsageSchema.safeParse(body);
  if (!parsed.success) return json({ error: "bad_row", issues: parsed.error.issues.length }, 400);

  // Превью ещё смотрит в боевую базу (Preview-переменные не переключены) — строка уже записана самим превью.
  if (parsed.data.source_ref && parsed.data.source_ref === supabaseRef()) return json({ ok: true, stored: false, reason: "same_db" });

  const row = toProdRow(parsed.data);
  const { error } = await db.from("ai_usage").insert(row);
  if (error) {
    console.error("[ai/usage] не удалось сохранить строку staging:", error.message);
    return json({ error: "db", message: error.message.slice(0, 200) }, 503);
  }
  return json({ ok: true, stored: true });
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}
