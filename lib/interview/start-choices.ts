// #233 (флаг culture_packs): варианты стартовой анкеты «Кто ваша семья?», «На каком языке удобнее рассказывать?»,
// «На каких языках книга?» и разбор ответа формы. Чистые функции без server-only: их зовут и страница /start
// (варианты пропсом в форму), и POST /api/families (проверка), и тесты.
import { CULTURE_PACKS, normalizePacks } from "@/content/packs";
import { BOOK_LANG_CHOICES } from "@/lib/pipeline/langs";
import type { BookLang, SpokenLang } from "@/lib/types";

export interface Choice {
  id: string;
  label: string;
  hint?: string;
}

/** Слои — в порядке реестра пакетов; «Просто общие вопросы» = general без слоёв. */
export const GENERAL_CHOICE: Choice = { id: "general", label: "Просто общие вопросы", hint: "без национальных тем" };

export function packChoices(): Choice[] {
  return Object.values(CULTURE_PACKS).map((p) => ({ id: p.id, label: p.title }));
}

export const SPOKEN_CHOICES = [
  { id: "ru,koryo", langs: ["ru", "koryo"], label: "По-русски, иногда на корё мар", pack: "koryo" },
  { id: "ru", langs: ["ru"], label: "По-русски" },
  { id: "ru,kk", langs: ["ru", "kk"], label: "По-русски, с казахскими словами", pack: "kz" },
  // #234 (spoken_kk): озвучка и показ вопроса по-казахски — позже; пока вопросы звучат по-русски
  { id: "kk", langs: ["kk"], label: "По-казахски", hint: "вопросы пока звучат по-русски", pack: "kz" },
] as const satisfies readonly { id: string; langs: readonly SpokenLang[]; label: string; hint?: string; pack?: string }[];

/** Языки рассказа, уместные для выбранных пакетов: корё мар — с корё-сарам, казахский — с казахской. */
export function spokenChoices(packs: readonly string[]): Choice[] {
  return SPOKEN_CHOICES.filter((c) => !("pack" in c) || packs.includes(c.pack)).map((c) => ({ id: c.id, label: c.label, ...("hint" in c ? { hint: c.hint } : {}) }));
}

/** Языки книги: казахский — только с флагом lang_kk (#231). */
export function bookChoices(kkOn: boolean): Choice[] {
  return BOOK_LANG_CHOICES.filter((c) => kkOn || !(c.langs as readonly string[]).includes("kk")).map((c) => ({ id: c.id, label: c.label, hint: c.hint }));
}

/** Что предложить по умолчанию для выбранных пакетов (пока семья сама не выбрала). Корё-сарам — как сегодня. */
export function defaultsFor(packs: readonly string[], kkOn: boolean): { spoken: string; book: string } {
  if (packs.includes("koryo")) return { spoken: "ru,koryo", book: "ru,ko" };
  if (packs.includes("kz")) return { spoken: "ru", book: kkOn ? "ru,kk" : "ru" };
  return { spoken: "ru", book: "ru" };
}

/** Выбор по умолчанию на форме = сегодняшний продукт (general + koryo, ru + корё мар, ru,ko). */
export const START_DEFAULT_PACKS = ["koryo"];

export class StartChoiceError extends Error {}

/**
 * Разбор ответа формы: packs (несколько значений), spoken, book. Неизвестное — ошибка (форма их не шлёт).
 * Ничего не выбрано в «Кто ваша семья?» — общий костяк.
 */
export function parseStartChoices(
  input: { packs: string[]; spoken?: string | null; book?: string | null },
  kkOn: boolean,
): { culture_packs: string[]; spoken_langs: SpokenLang[]; book_langs: BookLang[] } {
  const known = new Set(["general", ...Object.keys(CULTURE_PACKS)]);
  const bad = input.packs.find((p) => !known.has(p));
  if (bad) throw new StartChoiceError("Такого варианта «Кто ваша семья?» нет — обновите страницу");
  const culture_packs = normalizePacks(input.packs);
  const defaults = defaultsFor(culture_packs, kkOn);
  const spoken = SPOKEN_CHOICES.find((c) => c.id === (input.spoken || defaults.spoken));
  if (!spoken) throw new StartChoiceError("Выберите, на каком языке удобнее рассказывать");
  const book = bookChoices(kkOn).find((c) => c.id === (input.book || defaults.book));
  if (!book) throw new StartChoiceError("Выберите, на каких языках будет книга");
  return {
    culture_packs,
    spoken_langs: [...spoken.langs],
    book_langs: [...BOOK_LANG_CHOICES.find((c) => c.id === book.id)!.langs],
  };
}
