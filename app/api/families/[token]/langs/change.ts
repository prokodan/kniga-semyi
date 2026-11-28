import "server-only";
// #231 / #306: запись языков книги, согласие галочкой и перевод готовых глав — общее для PATCH «Языки книги» и
// POST «Добавить язык». Без Supabase (локально, mock) — память процесса, как MemoryFamilyStore.
import { randomUUID } from "node:crypto";
import { continueInBackground } from "@/lib/pipeline/chain";
import { loadStoryTexts } from "@/lib/book/texts";
import { getDbOrNull } from "@/lib/db";
import { getFamilyStore, MemoryFamilyStore } from "@/lib/db/access";
import { effectiveBookLangs, pendingTranslations } from "@/lib/pipeline/langs";
import type { MemoryPipelineRepo } from "@/lib/pipeline/repo";
import type { SaveLangOrder } from "@/lib/payments";
import type { BookLang, BookLangConsent, LangOrder, Story, Uuid } from "@/lib/types";

/** Сразу запускаем перевод стольких глав; остальные — при открытии страницы семьи / kick-stuck. */
const KICK_NOW = 8;

const mem = globalThis as { __langConsents?: BookLangConsent[]; __langOrders?: LangOrder[] };

/** Записать языки книги и поставить на перевод готовые главы, которым не хватает перевода. Возвращает id этих глав. */
export async function writeBookLangs(familyId: Uuid, langs: BookLang[]): Promise<string[]> {
  const db = getDbOrNull();
  let queued: string[] = [];
  if (db) {
    const { error } = await db.from("families").update({ book_langs: langs }).eq("id", familyId);
    if (error) throw new Error(`языки книги: ${error.message}`);
    const { data, error: e2 } = await db
      .from("stories")
      .select("id, text_ko, text_ru")
      .eq("family_id", familyId)
      .eq("status", "ready")
      .is("parent_story_id", null);
    if (e2) throw new Error(`главы семьи: ${e2.message}`);
    const stories = (data ?? []) as Pick<Story, "id" | "text_ko" | "text_ru">[];
    const rows = await loadStoryTexts(db, stories.map((s) => s.id));
    const target = effectiveBookLangs({ book_langs: langs }, true);
    queued = stories
      .filter((s) => s.text_ru && pendingTranslations(target, s, rows.filter((r) => r.story_id === s.id && r.text != null).map((r) => r.lang)).length > 0)
      .map((s) => s.id);
    if (queued.length) {
      const { error: e3 } = await db.from("stories").update({ status: "translating", error: null }).in("id", queued).eq("status", "ready");
      if (e3) throw new Error(`перевод глав: ${e3.message}`);
    }
  } else {
    const store = getFamilyStore();
    if (store instanceof MemoryFamilyStore) {
      const f = store.families.get(familyId);
      if (f) f.book_langs = langs;
    }
    (globalThis as { __pipelineMemoryRepo?: MemoryPipelineRepo }).__pipelineMemoryRepo?.bookLangs.set(familyId, langs);
  }
  return queued;
}

/** Перевод первых глав — сразу (каждая своим /process), остальные доведут открытие /f и kick-stuck. */
export function kickTranslations(req: Request, token: string, queued: readonly string[]): void {
  for (const id of queued.slice(0, KICK_NOW)) continueInBackground(req, id, token);
}

/** #306: согласие галочкой — текст ровно тот, что видела семья (consentText по новым языкам), и дата. */
export async function saveLangConsent(row: Omit<BookLangConsent, "id" | "agreed_at">): Promise<void> {
  const db = getDbOrNull();
  if (db) {
    const { error } = await db.from("book_lang_consents").insert(row);
    if (error) throw new Error(`согласие на языки: ${error.message}`);
    return;
  }
  (mem.__langConsents ??= []).push({ ...row, id: randomUUID(), agreed_at: new Date().toISOString() });
}

/** #306: демо-заказ языка — строка demo_orders (product = "lang"). */
export const saveLangOrder: SaveLangOrder = async (row) => {
  const db = getDbOrNull();
  if (db) {
    const { data, error } = await db.from("demo_orders").insert(row).select("id").single();
    if (error) throw new Error(`demo_orders insert: ${error.message}`);
    return (data as { id: Uuid }).id;
  }
  const order: LangOrder = { ...row, id: randomUUID(), created_at: new Date().toISOString() };
  (mem.__langOrders ??= []).push(order);
  return order.id;
};
