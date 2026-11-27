import { NextResponse } from "next/server";
import { getAiStore } from "@/lib/ai";
import { AI_USAGE_HEADER, buildUsageSummary, usageSecretOk } from "@/lib/ai/shared-usage";
import { env, isSupabaseConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

// #211: GET /api/ai/usage/summary — расход $ за сутки и месяц UTC по провайдерам, все окружения вместе
// (как считает бюджет роутер прода). Превью кэширует ответ ~60 с. Заголовок x-ai-usage-secret.
export async function GET(req: Request) {
  if (env.vercelEnv() === "preview") return json({ error: "not_found" }, 404);
  const secret = env.aiUsageSecret();
  if (!secret) return json({ error: "not_configured" }, 503);
  if (!usageSecretOk(req.headers.get(AI_USAGE_HEADER), secret)) return json({ error: "forbidden" }, 401);
  if (!isSupabaseConfigured()) return json({ error: "not_configured", message: "Supabase не настроен" }, 503);
  try {
    return json(await buildUsageSummary(getAiStore()));
  } catch (e) {
    console.error("[ai/usage/summary]", (e as Error).message);
    return json({ error: "internal" }, 500);
  }
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}
