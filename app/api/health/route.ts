import { NextResponse } from "next/server";
import { getDbOrNull } from "@/lib/db";
import { env, getAiMode, isAiUsageSinkEnabled } from "@/lib/env";
import { isStageMode } from "@/lib/stage";

export const dynamic = "force-dynamic";

// Проверка живости для smoke и Vercel. 200 + status "ok", если приложение живо и база
// отвечает (или ещё не настроена — тогда db: "not_configured"). 503 + "degraded", если база упала.
export async function GET() {
  const started = Date.now();
  const db = getDbOrNull();
  let dbStatus: "ok" | "not_configured" | "error" = "not_configured";
  let dbError: string | undefined;

  if (db) {
    // Обычный select, не head: true — на HEAD-запрос PostgREST отдаёт ошибку без тела,
    // и причина (например, «permission denied») терялась.
    try {
      const { error } = await db.from("families").select("id").limit(1);
      dbStatus = error ? "error" : "ok";
      if (error) dbError = formatDbError(error.code, error.message);
    } catch (e) {
      dbStatus = "error";
      dbError = formatDbError("fetch_failed", e instanceof Error ? e.message : String(e));
    }
  }

  // #171: таймер подстраховки (Supabase pg_cron → /api/cron/kick) — есть ли задание, секреты в Vault, последний ответ
  let cronKick: unknown = null;
  if (db && dbStatus === "ok") {
    try {
      const { data, error } = await db.rpc("cron_kick_status");
      cronKick = error ? { error: error.code ?? "rpc" } : data;
    } catch {
      cronKick = { error: "fetch_failed" };
    }
  }

  const ok = dbStatus !== "error";
  // #211: окружение и куда смотрит база — чтобы с телефона отличить прод от превью (staging).
  const vercelEnv = env.vercelEnv();
  const sink = vercelEnv === "preview" ? isAiUsageSinkEnabled() : Boolean(env.aiUsageSecret());
  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      db: dbStatus,
      ...(dbError ? { db_error: dbError } : {}),
      // production | preview | development (локально и в CI)
      env: vercelEnv,
      // Первые 6 символов ref проекта Supabase (не ключ): прод и staging различаются с одного взгляда
      supabase_ref: env.supabaseRefShort() ?? null,
      // Общий расход ИИ: превью — шлёт строки в прод, прод — принимает (задан AI_USAGE_SECRET); off — выключено
      ai_usage_sink: sink ? "ok" : "off",
      ai_mode: getAiMode(),
      // Для утреннего чек-листа 27.11 и smoke: только «задано / нет», без значений.
      stage_mode: isStageMode(),
      config: {
        admin_pin: Boolean(env.adminPin()),
        kiosk_pin: Boolean(env.kioskPin()),
        openai_key: Boolean(env.openaiApiKey()),
        listen_secret: Boolean(env.listenSecret()),
        cron_secret: Boolean(env.cronSecret()),
      },
      cron_kick: cronKick,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
      region: process.env.VERCEL_REGION ?? "local",
      latency_ms: Date.now() - started,
    },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}

// Только код и текст ошибки Postgres/PostgREST — без details/hint, URL и заголовков,
// чтобы в публичный ответ не попали секреты. Длину ограничиваем.
function formatDbError(code: string | undefined, message: string | undefined): string {
  const text = `${code || "unknown"}: ${message || "без текста"}`.replace(/\s+/g, " ").trim();
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}
