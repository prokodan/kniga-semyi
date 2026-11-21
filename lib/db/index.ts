import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, isSupabaseConfigured } from "@/lib/env";

// Серверный клиент Supabase с service-ключом. Владелец — Z6.
// Браузер никогда не ходит в базу напрямую: только через app/api/* и server actions.
// Доступ семьи — по ссылке с токеном (families.access_token), проверка в lib/db/access.ts (I1).

let client: SupabaseClient | null = null;

export function getDb(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase не настроен: нужны NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY");
  }
  client ??= createClient(env.supabaseUrl()!, env.supabaseServiceRoleKey()!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export function getDbOrNull(): SupabaseClient | null {
  return isSupabaseConfigured() ? getDb() : null;
}

export const BUCKETS = {
  audio: "audio",
  photos: "photos",
  books: "books",
  illustrations: "illustrations",
} as const;
