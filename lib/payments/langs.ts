// #306 (флаг lang_change): правила смены языков книги — чистые функции без server-only (страница семьи, API, тесты).
// Решение Данила 28.11: до первой готовой (бесплатной) главы языки книги можно сменить — с новым текстом согласия и
// галочкой «Согласен»; после неё базовые языки не меняются — можно только докупить ещё один язык (демо-оплата).
// «Бесплатной главы» как понятия в коде нет — считаем первую готовую главу семьи (основную, не уточнение).
import { BOOK_LANG_CHOICES, LANG_UI, type BookLangChoice } from "@/lib/pipeline/langs";
import type { BookLang } from "@/lib/types";
import { LANG_EXTRA_KZT } from "./index";

/** Предупреждение — на выборе языков (/start, «Языки книги») и в согласии. Формулировка Данила (#306). */
export const LANG_LOCK_WARNING = "После бесплатной главы сменить язык книги нельзя — можно только докупить ещё один язык.";

/** Языки, которые можно докупить: перевод с русского есть для корейского и казахского. */
const ADDABLE: readonly Exclude<BookLang, "ru">[] = ["kk", "ko"];

/** Есть ли у семьи готовая глава (первая готовая = «бесплатная»): после неё базовые языки книги не меняются. */
export function langsLocked(stories: readonly { status: string; parent_story_id?: string | null }[]): boolean {
  return stories.some((s) => s.status === "ready" && !s.parent_story_id);
}

/** Какие языки можно добавить к книге (их ещё нет среди языков книги). */
export function addableLangs(langs: readonly BookLang[]): Exclude<BookLang, "ru">[] {
  return ADDABLE.filter((l) => !langs.includes(l));
}

/** book_langs после покупки языка: базовая пара не меняется, новый язык — в конец. */
export function withAddedLang(langs: readonly BookLang[], lang: BookLang): BookLang[] {
  return langs.includes(lang) ? [...langs] : [...langs, lang];
}

/** Вариант «Языки книги» по базовой паре (первые два языка) — докупленные сверх неё не влияют на выбор. */
export function baseChoiceOf(langs: readonly BookLang[]): BookLangChoice | null {
  const base = langs.slice(0, 2).join(",");
  return BOOK_LANG_CHOICES.find((c) => c.langs.join(",") === base)?.id ?? null;
}

/** «казахский» / «корейский» — для кнопки «Добавить казахский». */
export function langName(lang: Exclude<BookLang, "ru">): string {
  return LANG_UI[lang].name;
}

export interface AddLangOffer {
  lang: Exclude<BookLang, "ru">;
  label: string;
  priceKzt: number;
}

/** Предложения «Добавить язык» для книги. */
export function addLangOffers(langs: readonly BookLang[]): AddLangOffer[] {
  return addableLangs(langs).map((lang) => ({ lang, label: `Добавить ${langName(lang)}`, priceKzt: LANG_EXTRA_KZT }));
}
