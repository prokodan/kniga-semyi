// Модель книги (I5): из глав семьи — порядок, оглавление, раздел «Слова деда».
// Чистые функции без сервера и React — тестируются напрямую.
import { orderByLife } from "../order";
import { BLOCKS } from "@/content/questions/blocks";
import { DEFAULT_BOOK_LANGS, type BookLang, type LifeBlock, type Story, type Storyteller } from "@/lib/types";

export type ChapterStory = Pick<
  Story,
  "id" | "block" | "title" | "title_ko" | "quote" | "quote_ko" | "text_ru" | "text_ko" | "sort_order" | "created_at" | "status" | "parent_story_id"
>;

export interface BookInput {
  /** Название на обложке и в колонтитуле, например «Книга семьи Ким» */
  title: string;
  storyteller: Pick<Storyteller, "name" | "name_ko" | "birth_year" | "death_year" | "birth_place">;
  /** Фото рассказчика (jpg/png) или null */
  photo: Buffer | null;
  stories: ChapterStory[];
  /** Абсолютная ссылка на голос главы для QR (подписанная /listen/<id>?s=) */
  voiceUrl: (storyId: string) => string;
  /** Дед или бабушка — для «Слова деда» / «Слова бабушки». Не задано — угадываем по имени. */
  elder?: Elder;
  builtAt?: Date;
  /**
   * #230: языки книги (families.book_langs), первый — основной. Не задано — ru, ko (как сейчас).
   * 1 язык — сплошной текст без второго языка; 2 — глава на основном, следом на втором (RU | KR как сейчас).
   * Пока второй язык печатается только корейский: казахский текст и шрифт — #231.
   */
  langs?: readonly BookLang[];
  /** #235: страница древа после оглавления; нет — книга как раньше */
  tree?: BookTree | null;
}

export type Elder = "grandfather" | "grandmother";

/** #235: человек на странице древа в PDF */
export interface BookTreePerson {
  name: string;
  nameKo: string | null;
  years: string | null;
  /** Кем приходится рассказчику книги («мама», «жена»); у рассказчика — null */
  label: string | null;
  viewer: boolean;
  /** Супруг стоящего справа — рисуем скрепу */
  spouseOfNext: boolean;
}

/** #235: страница «Древо семьи» — ряды поколений сверху вниз (только при флаге family_tree у семьи) */
export interface BookTree {
  rows: BookTreePerson[][];
}

export interface BookChapter {
  id: string;
  block: LifeBlock | null;
  blockRu: string;
  blockKo: string;
  title: string;
  titleKo: string | null;
  quote: string | null;
  quoteKo: string | null;
  textRu: string;
  textKo: string | null;
  voiceUrl: string;
}

export interface TocGroup {
  ru: string;
  ko: string;
  chapters: BookChapter[];
}

export interface BookModel {
  title: string;
  storyteller: BookInput["storyteller"];
  years: string | null;
  photo: Buffer | null;
  chapters: BookChapter[];
  /** Главы в порядке книги без legacy, по блокам карты жизни */
  groups: TocGroup[];
  elder: Elder;
  /** Раздел «Слова деда» в конце (пусто — раздела нет) */
  legacy: { ru: string; ko: string; chapters: BookChapter[] };
  builtAt: Date;
  /** Языки книги, первый — основной (#230) */
  langs: BookLang[];
  /** Второй язык книги, который печатаем (сейчас только ko); null — книга на одном языке */
  second: "ko" | null;
  /** #235: страница древа (null / нет — нет) */
  tree?: BookTree | null;
}

export const LEGACY_TITLE: Record<Elder, { ru: string; ko: string }> = {
  grandfather: { ru: "Слова деда", ko: "할아버지의 말씀" },
  grandmother: { ru: "Слова бабушки", ko: "할머니의 말씀" },
};

/**
 * Дед или бабушка по имени: отчество/фамилия на -овна/-евна/-ична/-ова/-ева/-ина/-ая/-ская
 * или слово «бабушка» → бабушка; иначе дед. Корейские имена (Ким Чер Су) не различаются — тогда
 * решает books.cover.elder (задаётся в базе), а по умолчанию — дед, как в сценарии питча.
 */
export function guessElder(name: string): Elder {
  const n = name.toLowerCase().replace(/ё/g, "е");
  if (/(бабушк|баба|омани|хальмони|할머니)/.test(n)) return "grandmother";
  if (/(дедушк|дед\b|аппади|харабоджи|할아버지)/.test(n)) return "grandfather";
  const words = n.split(/\s+/).filter(Boolean);
  if (words.some((w) => /(овна|евна|ична|инична)$/.test(w))) return "grandmother";
  if (words.some((w) => w.length > 3 && /(ова|ева|ина|ская|цкая)$/.test(w))) return "grandmother";
  return "grandfather";
}

/** «1941–2020» или «род. 1941» */
export function bookYears(st: Pick<Storyteller, "birth_year" | "death_year">): string | null {
  if (!st.birth_year) return null;
  return st.death_year ? `${st.birth_year}–${st.death_year}` : `род. ${st.birth_year}`;
}

/** Глава годится в книгу: готова, не ответ на уточнение, есть русский текст. */
export function isBookChapter(s: ChapterStory): boolean {
  return s.status === "ready" && !s.parent_story_id && Boolean(s.text_ru?.trim());
}

/** Порядок книги: разделы карты жизни (content/questions) → время записи. */
export function orderChapters<T extends ChapterStory>(stories: T[]): T[] {
  return orderByLife(stories);
}

/** Текст главы → абзацы (пустые строки и одиночные переводы строки — границы абзацев). */
export function paragraphs(text: string | null | undefined): string[] {
  return (text ?? "")
    .split(/\n+/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function composeBook(input: BookInput): BookModel {
  const elder = input.elder ?? guessElder(input.storyteller.name);
  const langs = input.langs?.length ? [...input.langs] : [...DEFAULT_BOOK_LANGS];
  const second = langs.length > 1 && langs[1] === "ko" ? "ko" : null;
  const ko = second === "ko";
  const chapters: BookChapter[] = orderChapters(input.stories.filter(isBookChapter)).map((s, i) => {
    const block = BLOCKS.find((b) => b.id === s.block);
    return {
      id: s.id,
      block: s.block,
      blockRu: block?.ru ?? "Рассказ",
      blockKo: ko ? (block?.ko ?? "이야기") : "",
      title: s.title?.trim() || `Рассказ ${i + 1}`,
      titleKo: (ko && s.title_ko?.trim()) || null,
      quote: s.quote?.trim() || null,
      quoteKo: (ko && s.quote_ko?.trim()) || null,
      textRu: s.text_ru!.trim(),
      textKo: (ko && s.text_ko?.trim()) || null,
      voiceUrl: input.voiceUrl(s.id),
    };
  });

  const groups: TocGroup[] = [];
  for (const ch of chapters) {
    if (ch.block === "legacy") continue;
    const last = groups.at(-1);
    if (last && last.ru === ch.blockRu) last.chapters.push(ch);
    else groups.push({ ru: ch.blockRu, ko: ch.blockKo, chapters: [ch] });
  }
  const legacyChapters = chapters.filter((c) => c.block === "legacy");

  return {
    title: input.title,
    storyteller: input.storyteller,
    years: bookYears(input.storyteller),
    photo: input.photo,
    // порядок страниц: обычные главы, затем «Слова деда»
    chapters: [...chapters.filter((c) => c.block !== "legacy"), ...legacyChapters],
    groups,
    elder,
    legacy: { ru: LEGACY_TITLE[elder].ru, ko: ko ? LEGACY_TITLE[elder].ko : "", chapters: legacyChapters },
    builtAt: input.builtAt ?? new Date(),
    langs,
    second,
    tree: input.tree && input.tree.rows.length ? input.tree : null,
  };
}
