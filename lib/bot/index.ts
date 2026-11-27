import "server-only";
import { getDbOrNull } from "@/lib/db";
import { getBotConfig } from "./config";
import { createGithub } from "./github";
import { createBot } from "./handler";
import { createOps } from "./ops";
import { MemoryBotStore, SupabaseBotStore, type BotStore } from "./store";
import { createTelegram } from "./telegram";
import type { HealthResult } from "./texts";

// Сборка бота для серверных ручек app/api/telegram/*.
let memory: MemoryBotStore | null = null;

function getStore(): BotStore {
  const db = getDbOrNull();
  if (db) return new SupabaseBotStore(db);
  memory ??= new MemoryBotStore(); // локально без Supabase: живёт до перезапуска
  return memory;
}

async function fetchHealth(baseUrl: string | undefined, timeoutMs = 10_000): Promise<HealthResult | null> {
  if (!baseUrl) return null;
  try {
    const res = await fetch(`${baseUrl}/api/health`, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    let json: Record<string, unknown> | null = null;
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {}
    return { ok: res.ok && json?.status === "ok", http: res.status, json };
  } catch (e) {
    return { ok: false, http: null, json: null, error: e instanceof Error ? e.name : "ошибка сети" };
  }
}

export function getBot() {
  const cfg = getBotConfig();
  if (!cfg.telegramToken) return null;
  return {
    cfg,
    bot: createBot({
      cfg,
      tg: createTelegram(cfg.telegramToken),
      gh: createGithub({ repo: cfg.repo, token: cfg.githubToken }),
      store: getStore(),
      fetchHealth: () => fetchHealth(cfg.prodUrl),
      fetchUrlHealth: (url) => fetchHealth(url, 5_000),
      ops: createOps(getDbOrNull()),
    }),
  };
}

export { getBotConfig, safeEqual } from "./config";
export { notifySchema } from "./notify";
