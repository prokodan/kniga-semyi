// #121 #124: одно имя — одно корейское написание во всей книге.
// Источник написания — словарь семьи (family_entities.name_ko): правка семьи (#104, source=family) важнее,
// иначе — как имя впервые написал переводчик в одной из глав (запоминаем после перевода).
// Переводчик получает словарь во входе (names) и сообщает, как написал имена этой главы (выход names);
// если он всё же написал имя по-другому — меняем его вариант на словарный в text_ko / title_ko / quote_ko.
// Чистые функции; запись в базу — repo.saveSpellings.
import type { FamilyEntity } from "@/lib/types";
import { sameEntity } from "./entities";

export interface NamePair {
  ru: string;
  ko: string;
}

type Entity = Pick<FamilyEntity, "id" | "kind" | "name_ru" | "name_ko" | "source" | "story_ids">;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Годится как корейское написание имени: хангыль, без кириллицы, коротко. */
export function validKo(ko: string | null | undefined): string | null {
  const v = (ko ?? "").replace(/\s+/g, " ").trim();
  if (!v || v.length > 40 || !/[가-힣]/.test(v) || /[А-Яа-яЁёA-Za-z]/.test(v)) return null;
  return v;
}

/** Как переводчик написал имя ru в этой главе (по его выходу names; падеж не важен). */
export function reportedKo(names: NamePair[] | undefined, ru: string): string | null {
  const hit = (names ?? []).find((n) => sameEntity(n.ru, ru));
  return hit ? validKo(hit.ko) : null;
}

/** Обязательные написания: люди и места словаря с name_ko; правка семьи — первой (при совпадении имён она и выигрывает). */
export function requiredSpellings(list: Entity[]): NamePair[] {
  const out: NamePair[] = [];
  const ranked = [...list].sort((a, b) => Number(b.source === "family") - Number(a.source === "family"));
  for (const e of ranked) {
    if (e.kind !== "person" && e.kind !== "place") continue;
    const ko = validKo(e.name_ko);
    if (!ko || out.some((p) => sameEntity(p.ru, e.name_ru))) continue;
    out.push({ ru: e.name_ru, ko });
  }
  return out;
}

/**
 * Заменить корейский вариант from на to — только с начала слова (после имени могут идти частицы: 렌나는 → 레나는).
 * Не трогаем, если from — часть to (안나 → 안나 페트로브나 дало бы удвоение) или слишком короткий (один слог).
 */
export function replaceKo(text: string, from: string, to: string): string {
  if (!text || from === to || from.length < 2 || to.includes(from)) return text;
  return text.replace(new RegExp(`(?<![가-힣])${escape(from)}`, "g"), to);
}

export interface Translated {
  text_ko: string;
  title_ko: string;
  quote_ko: string;
  names?: NamePair[];
}

export interface SpellingFix {
  ru: string;
  from: string;
  to: string;
}

/** Привести написания главы к словарю. Возвращает исправленный перевод и список замен (для логов / eval). */
export function applySpellings<T extends Translated>(out: T, required: NamePair[]): { out: T; fixed: SpellingFix[] } {
  const fixed: SpellingFix[] = [];
  let { text_ko, title_ko, quote_ko } = out;
  for (const r of required) {
    const from = reportedKo(out.names, r.ru);
    if (!from || from === r.ko) continue;
    const next = replaceKo(text_ko, from, r.ko);
    if (next === text_ko) continue; // варианта в тексте нет (или замена небезопасна) — не трогаем
    text_ko = next;
    title_ko = replaceKo(title_ko, from, r.ko);
    quote_ko = replaceKo(quote_ko, from, r.ko);
    fixed.push({ ru: r.ru, from, to: r.ko });
  }
  const names = out.names?.map((n) => {
    const r = required.find((x) => sameEntity(x.ru, n.ru));
    return r ? { ru: n.ru, ko: r.ko } : n;
  });
  return { out: { ...out, text_ko, title_ko, quote_ko, ...(names ? { names } : {}) }, fixed };
}

/**
 * Запомнить написание: люди и места этой главы, у которых в словаре ещё нет name_ko, — как их написал переводчик.
 * Первая переведённая глава задаёт написание для всей книги; уже заданное (правка семьи #104) не меняем.
 */
export function learnSpellings(list: Entity[], names: NamePair[] | undefined, storyId: string): { id: string; name_ko: string }[] {
  const out: { id: string; name_ko: string }[] = [];
  for (const e of list) {
    if (e.kind !== "person" && e.kind !== "place") continue;
    if (validKo(e.name_ko)) continue; // написание уже есть (в т. ч. правка семьи) — не трогаем
    if (!(e.story_ids ?? []).includes(storyId)) continue;
    const ko = reportedKo(names, e.name_ru);
    if (ko) out.push({ id: e.id, name_ko: ko });
  }
  return out;
}
