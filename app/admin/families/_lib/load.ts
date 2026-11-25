import "server-only";
// #201: строки для админки «Семьи» — Supabase (service-ключ) постранично или память сервера в локальном режиме.
// Токены семей уходят только в ссылки страницы /admin/families (под ADMIN_PIN), в логи — никогда.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDbOrNull } from "@/lib/db";
import { getFamilyStore, type MemoryFamilyStore } from "@/lib/db/access";
import type { Book } from "@/lib/types";
import type { AdminFamilyRows, BookPick, FamilyPick, OrderPick, StoryPick, UsagePick } from "./families";

/** Supabase отдаёт не больше 1000 строк за запрос (max_rows) — читаем страницами. */
const PAGE = 1000;
const MAX_PAGES = 50;

async function all<T>(db: SupabaseClient, table: string, columns: string, notNull?: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    let q = db.from(table).select(columns);
    if (notNull) q = q.not(notNull, "is", null);
    const { data, error } = await q.order("created_at", { ascending: true }).range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

type MemoryGlobals = {
  __bookMemory?: Map<string, { book: Book }>;
  __demoOrderStore?: { orders: OrderPick[] };
};

export async function loadAdminFamilyRows(): Promise<{ source: "supabase" | "memory"; rows: AdminFamilyRows }> {
  const db = getDbOrNull();
  if (!db) {
    const store = getFamilyStore() as Partial<MemoryFamilyStore>;
    const g = globalThis as MemoryGlobals;
    return {
      source: "memory",
      rows: structuredClone({
        families: [...(store.families?.values() ?? [])] as FamilyPick[],
        stories: [...(store.stories?.values() ?? [])] as StoryPick[],
        books: [...(g.__bookMemory?.values() ?? [])].map(({ book }) => book) as BookPick[],
        orders: [...(g.__demoOrderStore?.orders ?? [])],
        usage: [] as UsagePick[],
      }),
    };
  }
  const [families, stories, books, orders, usage] = await Promise.all([
    all<FamilyPick>(db, "families", "id, name, source, is_demo, access_token, created_at"),
    all<StoryPick>(db, "stories", "id, family_id, status, parent_story_id"),
    all<BookPick>(db, "books", "family_id, status, page_count, created_at"),
    all<OrderPick>(db, "demo_orders", "family_id, product, amount_kzt, extras, status, created_at"),
    // расход ИИ на семью — через story_id (шаги без истории, например сказка, сюда не попадают)
    all<UsagePick>(db, "ai_usage", "story_id, cost_usd", "story_id"),
  ]);
  return { source: "supabase", rows: { families, stories, books, orders, usage } };
}
