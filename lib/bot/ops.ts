// Данные бота из базы (#212): цифры сводки одним rpc и демо-семьи для «Ссылок».
// Токены демо-семей уходят только в личку участника с ролью (handler.linksView) — здесь не логируются.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DigestStats } from "./digest";
import type { DemoFamily } from "./texts";

export function createOps(db: SupabaseClient | null) {
  return {
    async stats(): Promise<DigestStats | null> {
      if (!db) return null;
      const { data, error } = await db.rpc("bot_digest_stats");
      if (error) {
        console.error("[bot] bot_digest_stats", error.code ?? "rpc");
        return null;
      }
      return (data as DigestStats | null) ?? null;
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
