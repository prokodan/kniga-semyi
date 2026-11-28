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
  // #300: только с флагом spoken_kk (spokenChoices); озвучка и показ вопроса по-казахски — #234, пока вопросы звучат по-русски
  { id: "kk", langs: ["kk"], label: "По-казахски", hint: "вопросы пока звучат по-русски", pack: "kz" },
] as const satisfies readonly { id: string; langs: readonly SpokenLang[]; label: string; hint?: string; pack?: string }[];

/** «По-казахски» (рассказ целиком на kk) — только с флагом spoken_kk (#300): расшифровка kk не проверена на живых записях (#238). */
const SPOKEN_KK_ONLY = "kk";

/**
 * Языки рассказа, уместные для выбранных пакетов: корё мар — с корё-сарам, казахский — с казахской.
 * «По-казахски» — только при `spokenKkOn` (флаг spoken_kk); «По-русски, с казахскими словами» — как было.
 */
export function spokenChoices(packs: readonly string[], spokenKkOn = false): Choice[] {
  return SPOKEN_CHOICES.filter((c) => (!("pack" in c) || packs.includes(c.pack)) && (spokenKkOn || c.id !== SPOKEN_KK_ONLY)).map((c) => ({
    id: c.id,
    label: c.label,
    ...("hint" in c ? { hint: c.hint } : {}),
  }));
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

/**
 * #301 (решение Данила 28.11): умолчание «Кто ваша семья?» — по точке входа. Ссылка АКНЦ (`/start?pack=koryo`) и
 * киоск — корё-сарам, как сейчас; общая ссылка `/start` — ничего не отмечено, семья выбирает сама (пустой выбор —
 * общий костяк, книга RU). Киоск создаёт семьи своей ручкой — у них умолчания базы (general + koryo).
 */
export const AKNC_START_LINK = "/start?pack=koryo";

/** Отмечено заранее на /start: `?pack=<слой>` из реестра пакетов (АКНЦ — koryo) или ничего (общая ссылка). */
export function startDefaultPacks(entryPack: string | null | undefined): string[] {
  return entryPack && entryPack !== "general" && Object.prototype.hasOwnProperty.call(CULTURE_PACKS, entryPack) ? [entryPack] : [];
}

export class StartChoiceError extends Error {}

/**
 * Разбор ответа формы: packs (несколько значений), spoken, book. Неизвестное — ошибка (форма их не шлёт).
 * `spokenKkOn` — флаг spoken_kk (#300): без него «По-казахски» — ошибка.
 * Ничего не выбрано в «Кто ваша семья?» — общий костяк.
 */
export function parseStartChoices(
  input: { packs: string[]; spoken?: string | null; book?: string | null },
  kkOn: boolean,
  spokenKkOn = false,
): { culture_packs: string[]; spoken_langs: SpokenLang[]; book_langs: BookLang[] } {
  const known = new Set(["general", ...Object.keys(CULTURE_PACKS)]);
  const bad = input.packs.find((p) => !known.has(p));
  if (bad) throw new StartChoiceError("Такого варианта «Кто ваша семья?» нет — обновите страницу");
  const culture_packs = normalizePacks(input.packs);
  const defaults = defaultsFor(culture_packs, kkOn);
  const spokenId = input.spoken || defaults.spoken;
  // #300: «По-казахски» без флага spoken_kk не принимаем (на форме его нет)
  const spoken = spokenId === SPOKEN_KK_ONLY && !spokenKkOn ? undefined : SPOKEN_CHOICES.find((c) => c.id === spokenId);
  if (!spoken) throw new StartChoiceError("Выберите, на каком языке удобнее рассказывать");
  const book = bookChoices(kkOn).find((c) => c.id === (input.book || defaults.book));
  if (!book) throw new StartChoiceError("Выберите, на каких языках будет книга");
  return {
    culture_packs,
    spoken_langs: [...spoken.langs],
    book_langs: [...BOOK_LANG_CHOICES.find((c) => c.id === book.id)!.langs],
  };
}
