import "server-only";
// #274 (флаг lang_kk): казахская страница главы для книги RU + KZ. Только сервер.
// Языки книги — families.book_langs с учётом флага (effectiveBookLangs, #231); текст — строка story_texts (lang kk),
// как в книге и конвейере (lib/book/texts.ts), не колонки *_ko. Флаг выключен / книга ru,ko / сбой — null:
// страница главы рисуется как до #274.
import { chapterText, loadStoryTexts } from "@/lib/book/texts";
import { getDbOrNull } from "@/lib/db";
import { getFamilyByToken } from "@/lib/db/access";
import { flag } from "@/lib/flags";
import { effectiveBookLangs } from "@/lib/pipeline/langs";
import type { Story } from "@/lib/types";

export interface KkChapter {
  /** Казахский текст главы; null — перевода ещё нет (страница — только RU). */
  page: { title: string | null; text: string | null; quote: string | null } | null;
}

/** Книга семьи RU + KZ (флаг lang_kk) → казахская страница главы; иначе null — страница как раньше. */
export async function loadKkChapter(story: Story, token: string): Promise<KkChapter | null> {
  try {
    const view = await getFamilyByToken(token);
    if (!view || view.family.id !== story.family_id) return null;
    const { family } = view;
    const on = flag("lang_kk", { familyId: family.id, labs: family.labs ?? null });
    if (!effectiveBookLangs(family, on).includes("kk")) return null;
    const db = getDbOrNull();
    const rows = db ? await loadStoryTexts(db, [story.id]) : [];
    const kk = chapterText(story, rows, "kk");
    return { page: kk.text ? kk : null };
  } catch (e) {
    console.warn("[chapter] kk:", e instanceof Error ? e.message : e);
    return null; // казахский не прочитали — страница как раньше, не падаем
  }
}
