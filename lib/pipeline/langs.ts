// #231: на какие языки переводить главу — чистые функции (без server-only, для тестов и симулятора).
// Языки книги — families.book_langs (первый — основной, L0 #230). Казахский — только с флагом lang_kk:
// флаг выключен, а в book_langs есть kk (семье выключили labs) → книга как сейчас (ru, ko).
import { bookLangs } from "@/lib/book/texts";
import { DEFAULT_BOOK_LANGS, type BookLang } from "@/lib/types";

/** Языки книги семьи с учётом флага lang_kk. */
export function effectiveBookLangs(family: { book_langs?: readonly string[] | null } | null | undefined, kkOn: boolean): BookLang[] {
  const langs = bookLangs(family);
  if (!kkOn && langs.includes("kk")) return [...DEFAULT_BOOK_LANGS];
  // #306: докупленный язык («Добавить язык») — третьим в book_langs, после базовой пары; только с lang_kk
  return kkOn ? [...langs, ...extraBookLangs(family, langs)] : langs;
}

/**
 * #306: докупленные языки сверх базовой пары — book_langs[2…] (известные, без повторов). Базовая пара — первые два
 * (bookLangs), её семья выбирает до первой готовой главы; третий язык появляется только после демо-оплаты.
 */
export function extraBookLangs(
  family: { book_langs?: readonly string[] | null } | null | undefined,
  base: readonly BookLang[] = bookLangs(family),
): Exclude<BookLang, "ru">[] {
  if (base.length < 2) return []; // книга «только RU»: добавленный язык становится вторым, а не третьим
  const raw = (family?.book_langs ?? []).slice(2);
  const out: Exclude<BookLang, "ru">[] = [];
  for (const l of raw) {
    if ((l === "ko" || l === "kk") && !base.includes(l) && !out.includes(l)) out.push(l);
  }
  return out;
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

// ── #299: подписи интерфейса по языкам книги ─────────────────────────────────────────────────────────────────
// Одно место для «на корейский / на казахский / без перевода» во всём интерфейсе семьи. Книга ru,ko — строки
// ровно те же, что до #299 (тест сверяет байт в байт). Казахские строки — от команды, вычитка носителем — #295;
// где казахского текста ещё нет (QR, подвал /listen) — строки просто нет, корейскую не показываем.

/** Второй язык книги — язык перевода главы. */
export type SecondLang = Exclude<BookLang, "ru">;

/** Второй язык книги; null — книга только на русском (перевода нет). */
export function secondLang(langs: readonly BookLang[]): SecondLang | null {
  return (langs.find((l) => l !== "ru") as SecondLang | undefined) ?? null;
}

export interface LangUi {
  /** «корейский» — в «… перевод» */
  name: string;
  /** «на корейский» — в «переводим …» */
  to: string;
  /** «корейском» — в «главы на русском и …» */
  prep: string;
  /** Подпись поля имени: «По-корейски» */
  adverb: string;
  /** Подпись «우리 이야기» рядом с «Книга семьи»; null — без второй строки */
  tagline: string | null;
  /** Вторая строка под QR («наведите камеру…»); null — только по-русски */
  qr: string | null;
  /** Подвал страницы голоса /listen; null — только по-русски */
  listenFooter: string | null;
}

export const LANG_UI: Readonly<Record<SecondLang, LangUi>> = {
  ko: {
    name: "корейский",
    to: "на корейский",
    prep: "корейском",
    adverb: "По-корейски",
    tagline: "우리 이야기",
    qr: "카메라를 대면 목소리를 들을 수 있어요",
    listenFooter: "손주들을 위한 가족의 이야기",
  },
  kk: {
    name: "казахский",
    to: "на казахский",
    prep: "казахском",
    adverb: "По-казахски",
    tagline: null, // казахскую подпись даст носитель (#295)
    qr: null, // #294: строка — от носителя (#295)
    listenFooter: null,
  },
};

/** Подписи второго языка книги; null — книга только на русском. */
export function langUi(langs: readonly BookLang[]): LangUi | null {
  const second = secondLang(langs);
  return second ? LANG_UI[second] : null;
}

/** «на русском и корейском» / «на русском и казахском» / «на русском». */
export function bookLangsPhrase(langs: readonly BookLang[]): string {
  const ui = langUi(langs);
  return ui ? `на русском и ${ui.prep}` : "на русском";
}

/** Подпись шага перевода на экране ожидания главы: «Переводим на корейский»; null — шага нет (книга только RU). */
export function translatingStep(langs: readonly BookLang[]): string | null {
  const ui = langUi(langs);
  return ui ? `Переводим ${ui.to}` : null;
}

/** Сообщение статуса translating: «Переводим главу на корейский…» (как STATUS_MESSAGE в engine.ts). */
export function translatingMessage(langs: readonly BookLang[]): string {
  const ui = langUi(langs);
  return ui ? `Переводим главу ${ui.to}…` : "Заканчиваем главу…";
}
