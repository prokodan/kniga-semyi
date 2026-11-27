// #231: на какие языки переводить главу — чистые функции (без server-only, для тестов и симулятора).
// Языки книги — families.book_langs (первый — основной, L0 #230). Казахский — только с флагом lang_kk:
// флаг выключен, а в book_langs есть kk (семье выключили labs) → книга как сейчас (ru, ko).
import { bookLangs } from "@/lib/book/texts";
import { DEFAULT_BOOK_LANGS, type BookLang } from "@/lib/types";

/** Языки книги семьи с учётом флага lang_kk. */
export function effectiveBookLangs(family: { book_langs?: readonly string[] | null } | null | undefined, kkOn: boolean): BookLang[] {
  const langs = bookLangs(family);
  return !kkOn && langs.includes("kk") ? [...DEFAULT_BOOK_LANGS] : langs;
}

/** Переводы главы: все языки книги, кроме языка оригинала (сейчас глава всегда пишется по-русски — edit). */
export function translationTargets(langs: readonly BookLang[], source: BookLang = "ru"): BookLang[] {
  return langs.filter((l) => l !== source);
}

/** Каких переводов главы ещё нет: ko — колонка text_ko, остальные — строка story_texts с текстом. */
export function pendingTranslations(
  langs: readonly BookLang[],
  story: { text_ko?: string | null },
  have: readonly BookLang[],
  source: BookLang = "ru",
): BookLang[] {
  return translationTargets(langs, source).filter((l) => (l === "ko" ? !story.text_ko : !have.includes(l)));
}

/** Варианты «Языки книги» на странице семьи (решение Данила 27.11: RU / RU+KR / RU+KZ — одна цена). */
export const BOOK_LANG_CHOICES = [
  { id: "ru,ko", langs: ["ru", "ko"], label: "Русский и корейский", hint: "как сейчас: глава по-русски, рядом перевод на корейский" },
  { id: "ru,kk", langs: ["ru", "kk"], label: "Русский и казахский", hint: "глава по-русски, рядом перевод на казахский" },
  { id: "ru", langs: ["ru"], label: "Только русский", hint: "без перевода" },
] as const satisfies readonly { id: string; langs: readonly BookLang[]; label: string; hint: string }[];

export type BookLangChoice = (typeof BOOK_LANG_CHOICES)[number]["id"];

export function choiceOf(langs: readonly BookLang[]): BookLangChoice | null {
  return BOOK_LANG_CHOICES.find((c) => c.langs.join(",") === langs.join(","))?.id ?? null;
}
