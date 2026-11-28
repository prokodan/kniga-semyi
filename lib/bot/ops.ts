// Данные бота из базы (#212): цифры сводки одним rpc и демо-семьи для «Ссылок».
// Токены демо-семей уходят только в личку участника с ролью (handler.linksView) — здесь не логируются.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DigestStats } from "./digest";
import type { DemoFamily } from "./texts";

function read(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

/**
 * #263: база staging для строки «ИИ staging» в сводке (у превью свой бюджет и свои ключи, #218 / #237).
 * Нужны BOT_STAGING_SUPABASE_URL (или STAGING_SUPABASE_URL) и BOT_STAGING_SUPABASE_SERVICE_ROLE_KEY
 * (или STAGING_SUPABASE_SERVICE_ROLE_KEY) в Vercel Production. Нет их или это своя же база — null (строка как раньше).
 */
export function stagingDbFromEnv(): SupabaseClient | null {
  const url = (read("BOT_STAGING_SUPABASE_URL") ?? read("STAGING_SUPABASE_URL"))?.replace(/\/+$/, "");
  const key = read("BOT_STAGING_SUPABASE_SERVICE_ROLE_KEY") ?? read("STAGING_SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key || !/^https:\/\//.test(url)) return null;
  if (url === read("NEXT_PUBLIC_SUPABASE_URL")?.replace(/\/+$/, "")) return null; // сводка на самом превью
  return createClient(url, key, { auth: { persistSession: false } });
}

async function rpcStats(db: SupabaseClient, label: string): Promise<DigestStats | null> {
  const { data, error } = await db.rpc("bot_digest_stats");
  if (error) {
    console.error(`[bot] bot_digest_stats${label}`, error.code ?? "rpc");
    return null;
  }
  return (data as DigestStats | null) ?? null;
}

export function createOps(db: SupabaseClient | null, staging: SupabaseClient | null = null) {
  return {
    async stats(): Promise<DigestStats | null> {
      if (!db) return null;
      return rpcStats(db, "");
    },
    /** #263: undefined — база staging не настроена; null — не ответила (≤ 8 с). */
    async stagingStats(): Promise<DigestStats | null | undefined> {
      if (!staging) return undefined;
      const timeout = new Promise<null>((r) => setTimeout(() => r(null), 8_000));
      return Promise.race([rpcStats(staging, " (staging)").catch(() => null), timeout]);
    },
    async demoFamilies(): Promise<DemoFamily[]> {
      if (!db) return [];
      const { data, error } = await db
        .from("families")
        .select("name,access_token,source")
        .eq("is_demo", true)
        .order("created_at", { ascending: true })
        .limit(4);
      if (error) {
        console.error("[bot] demo families", error.code ?? "select");
        return [];
      }
      return (data ?? []).map((f) => ({ name: String(f.name), token: String(f.access_token), source: String(f.source) }));
    },
  };
}
