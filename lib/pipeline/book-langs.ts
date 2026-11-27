import "server-only";
// #299: языки книги семьи для подписей интерфейса (сервер). Тот же расчёт, что в конвейере и PDF:
// families.book_langs с учётом флага lang_kk (effectiveBookLangs). Сбой / нет колонки — как до v2 (ru, ko):
// подписи остаются прежними, страница не падает.
import { getDbOrNull } from "@/lib/db";
import { getFamilyStore, type MemoryFamilyStore } from "@/lib/db/access";
import { flag } from "@/lib/flags";
import { DEFAULT_BOOK_LANGS, type BookLang, type Family } from "@/lib/types";
import { effectiveBookLangs } from "./langs";

type FamilyLangs = Pick<Family, "id"> & { book_langs?: readonly string[] | null; labs?: string[] | null };

/** Языки книги уже загруженной семьи (страницы по токену). */
export function familyBookLangs(family: FamilyLangs): BookLang[] {
  return effectiveBookLangs(family, flag("lang_kk", { familyId: family.id, labs: family.labs ?? null }));
}

/** Языки книги по id семьи (страница голоса /listen — без токена). */
export async function familyBookLangsById(familyId: string): Promise<BookLang[]> {
  try {
    const db = getDbOrNull();
    if (!db) {
      const store = getFamilyStore() as Partial<MemoryFamilyStore>;
      const family = store.families?.get(familyId);
      return family ? familyBookLangs(family) : [...DEFAULT_BOOK_LANGS];
    }
    const { data, error } = await db.from("families").select("id, book_langs, labs").eq("id", familyId).maybeSingle();
    if (error || !data) return [...DEFAULT_BOOK_LANGS];
    return familyBookLangs(data as FamilyLangs);
  } catch (e) {
    console.warn("[book-langs]", e instanceof Error ? e.message : e);
    return [...DEFAULT_BOOK_LANGS];
  }
}
