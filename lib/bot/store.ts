// Хранилище бота: участники (bot_users) и настройки уведомлений (bot_settings).
// В проде — Supabase с service-ключом; без базы и в тестах — память.
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_PREFS, type Prefs } from "./notify";

export type Role = "danil" | "vlad";
export type BotUser = { tg_id: number; name: string; github_login: string | null; role: Role | null };

export interface BotStore {
  getUser(tgId: number): Promise<BotUser | null>;
  upsertUser(user: BotUser): Promise<BotUser>;
  listUsers(): Promise<BotUser[]>;
  getPrefs(chatId: string): Promise<Prefs>;
  savePrefs(chatId: string, prefs: Prefs): Promise<void>;
}

export class MemoryBotStore implements BotStore {
  users = new Map<number, BotUser>();
  prefs = new Map<string, Prefs>();
  async getUser(id: number) {
    return this.users.get(id) ?? null;
  }
  async upsertUser(u: BotUser) {
    this.users.set(u.tg_id, { ...u });
    return u;
  }
  async listUsers() {
    return [...this.users.values()];
  }
  async getPrefs(chatId: string) {
    return { ...DEFAULT_PREFS, ...this.prefs.get(chatId) };
  }
  async savePrefs(chatId: string, p: Prefs) {
    this.prefs.set(chatId, { ...p });
  }
}

export class SupabaseBotStore implements BotStore {
  constructor(private db: SupabaseClient) {}

  async getUser(tgId: number) {
    const { data, error } = await this.db.from("bot_users").select("tg_id,name,github_login,role").eq("tg_id", tgId).maybeSingle();
    if (error) throw new Error(`bot_users: ${error.message}`);
    return (data as BotUser | null) ?? null;
  }
  async upsertUser(u: BotUser) {
    const { error } = await this.db.from("bot_users").upsert({ ...u, updated_at: new Date().toISOString() });
    if (error) throw new Error(`bot_users: ${error.message}`);
    return u;
  }
  async listUsers() {
    const { data, error } = await this.db.from("bot_users").select("tg_id,name,github_login,role");
    if (error) throw new Error(`bot_users: ${error.message}`);
    return (data ?? []) as BotUser[];
  }
  async getPrefs(chatId: string) {
    const { data, error } = await this.db.from("bot_settings").select("prefs").eq("chat_id", chatId).maybeSingle();
    if (error) throw new Error(`bot_settings: ${error.message}`);
    return { ...DEFAULT_PREFS, ...((data?.prefs as Partial<Prefs> | undefined) ?? {}) };
  }
  async savePrefs(chatId: string, prefs: Prefs) {
    const { error } = await this.db
      .from("bot_settings")
      .upsert({ chat_id: chatId, prefs, updated_at: new Date().toISOString() });
    if (error) throw new Error(`bot_settings: ${error.message}`);
  }
}
