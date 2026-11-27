import { NextResponse } from "next/server";
import { aiConfigFingerprint, routesMatch } from "@/lib/ai/config-fingerprint";
import { getDbOrNull } from "@/lib/db";
import { env, getAiMode, isAiUsageSinkEnabled } from "@/lib/env";
import { flagsOn } from "@/lib/flags";
import { isStageMode } from "@/lib/stage";

export const dynamic = "force-dynamic";

// Проверка живости для smoke и Vercel. 200 + status "ok", если приложение живо и база
// отвечает (или ещё не настроена — тогда db: "not_configured"). 503 + "degraded", если база упала.
export async function GET(req: Request) {
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

  // #222: отпечаток настроек ИИ (маршруты + провайдеры без бюджетов); превью сравнивает его с продом
  let aiRoutesHash: string | null = null;
  if (db && dbStatus === "ok") {
    try {
      const [routes, providers] = await Promise.all([
        db.from("ai_routes").select("step, providers, pinned_provider, timeout_ms, enabled"),
        db.from("ai_providers").select("provider, enabled, paid, cooldown_minutes"),
      ]);
      if (!routes.error && !providers.error) aiRoutesHash = aiConfigFingerprint(routes.data ?? [], providers.data ?? []);
    } catch {
      aiRoutesHash = null;
    }
  }

  const ok = dbStatus !== "error";
  // #211: окружение и куда смотрит база — чтобы с телефона отличить прод от превью (staging).
  const vercelEnv = env.vercelEnv();
  const sink = vercelEnv === "preview" ? isAiUsageSinkEnabled() : Boolean(env.aiUsageSecret());
  // #222: на превью — совпадают ли маршруты ИИ с продом (null — прод не ответил / нет PROD_URL / нет базы)
  const matchProd = vercelEnv === "preview" && !req.headers.get(PROBE_HEADER) ? routesMatch(aiRoutesHash, await prodRoutesHash()) : undefined;
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
      // #222: отпечаток ai_routes + ai_providers (без бюджетов) — 12 hex, не секрет
      ai_routes_hash: aiRoutesHash,
      // #222: только на превью — false = настройки ИИ разошлись с продом (Actions → seed-demo target=staging)
      ...(matchProd !== undefined ? { ai_routes_match_prod: matchProd } : {}),
      // Для утреннего чек-листа 27.11 и smoke: только «задано / нет», без значений.
      stage_mode: isStageMode(),
      // #223: флаги, включённые окружением (FLAGS_ON / по умолчанию) — только имена; выкатка по семьям сюда не входит
      flags_on: flagsOn(),
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

// #222: отпечаток настроек ИИ прода — из его /api/health (публичный, без секрета). Кэш 60 с на инстанс.
const PROBE_HEADER = "x-health-probe";
let prodHashCache: { value: string | null; at: number } | null = null;
async function prodRoutesHash(): Promise<string | null> {
  const prodUrl = env.productionUrl();
  if (!prodUrl) return null;
  if (prodHashCache && Date.now() - prodHashCache.at < 60_000) return prodHashCache.value;
  let value: string | null = null;
  try {
    const res = await fetch(`${prodUrl}/api/health`, {
      headers: { [PROBE_HEADER]: "1" },
      cache: "no-store",
      signal: AbortSignal.timeout(2_500),
    });
    const body = (await res.json()) as { ai_routes_hash?: unknown; env?: unknown };
    // Защита от петли: PROD_URL указывает не на прод (например, на само превью) — не сравниваем.
    if (body.env === "production" && typeof body.ai_routes_hash === "string") value = body.ai_routes_hash;
  } catch {
    value = null;
  }
  prodHashCache = { value, at: Date.now() };
  return value;
}

// Только код и текст ошибки Postgres/PostgREST — без details/hint, URL и заголовков,
// чтобы в публичный ответ не попали секреты. Длину ограничиваем.
function formatDbError(code: string | undefined, message: string | undefined): string {
  const text = `${code || "unknown"}: ${message || "без текста"}`.replace(/\s+/g, " ").trim();
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}
