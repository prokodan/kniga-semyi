// #230: тексты главы по языкам (story_texts) поверх старых колонок stories. Чистые функции + загрузка с сервера.
// Правило чтения (LANGUAGES.md §2.4): строка story_texts для языка есть → берём её, иначе — старые колонки
// (text_ru / title / quote и text_ko / title_ko / quote_ko). Пока колонки — зеркало story_texts (триггер
// stories_mirror_texts в миграции 20261127180000), результат для ru и ko совпадает с сегодняшним.
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_BOOK_LANGS, type BookLang, type Story, type StoryText } from "@/lib/types";

export type StoryTextRow = Pick<StoryText, "story_id" | "lang" | "title" | "text" | "quote">;
type TextColumns = Pick<Story, "text_ru" | "title" | "quote" | "text_ko" | "title_ko" | "quote_ko">;

/** Текст главы на языке `lang`: строка story_texts, иначе старые колонки (только ru / ko). */
export function chapterText(
  story: TextColumns & { id: string },
  rows: readonly StoryTextRow[],
  lang: BookLang,
): { title: string | null; text: string | null; quote: string | null } {
  const row = rows.find((r) => r.story_id === story.id && r.lang === lang);
  if (row) return { title: row.title, text: row.text, quote: row.quote };
  if (lang === "ru") return { title: story.title, text: story.text_ru, quote: story.quote };
  if (lang === "ko") return { title: story.title_ko, text: story.text_ko, quote: story.quote_ko };
  return { title: null, text: null, quote: null };
}

/** Story с колонками ru / ko, прочитанными по правилу story_texts → колонки (для кода, который читает колонки). */
export function withStoryTexts<T extends TextColumns & { id: string }>(story: T, rows: readonly StoryTextRow[]): T {
  const ru = chapterText(story, rows, "ru");
  const ko = chapterText(story, rows, "ko");
  return { ...story, text_ru: ru.text, title: ru.title, quote: ru.quote, text_ko: ko.text, title_ko: ko.title, quote_ko: ko.quote };
}

/** Строки story_texts в том виде, в каком их пишет зеркало stories → story_texts (для хранилищ в памяти). */
export function mirrorRows(story: TextColumns & { id: string }): StoryTextRow[] {
  const rows: StoryTextRow[] = [];
  if (story.text_ru != null || story.title != null || story.quote != null)
    rows.push({ story_id: story.id, lang: "ru", title: story.title, text: story.text_ru, quote: story.quote });
  if (story.text_ko != null || story.title_ko != null || story.quote_ko != null)
    rows.push({ story_id: story.id, lang: "ko", title: story.title_ko, text: story.text_ko, quote: story.quote_ko });
  return rows;
}

/** Языки книги семьи: families.book_langs, без мусора и повторов; пусто / нет колонки — как сейчас (ru, ko). */
export function bookLangs(family: { book_langs?: readonly string[] | null } | null | undefined): BookLang[] {
  const known: readonly string[] = ["ru", "ko", "kk"];
  const langs = [...new Set((family?.book_langs ?? []).filter((l) => known.includes(l)))] as BookLang[];
  return langs.length ? langs.slice(0, 2) : [...DEFAULT_BOOK_LANGS];
}

/** story_texts для глав. Нет таблицы (до migrate) / ошибка — пусто: читаем старые колонки, книга не падает. */
export async function loadStoryTexts(db: SupabaseClient, storyIds: readonly string[]): Promise<StoryTextRow[]> {
  if (storyIds.length === 0) return [];
  const rows: StoryTextRow[] = [];
  for (let i = 0; i < storyIds.length; i += 200) {
    const { data, error } = await db.from("story_texts").select("story_id, lang, title, text, quote").in("story_id", storyIds.slice(i, i + 200));
    if (error) return [];
    rows.push(...((data ?? []) as StoryTextRow[]));
  }
  return rows;
}
