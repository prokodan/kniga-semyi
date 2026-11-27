// Банк вопросов из культурных пакетов (#230, docs/v2/LANGUAGES.md §2): resolveBank(packs, spokenLang) — чистая функция.
// general — костяк (всегда первым), слои применяются по порядку `families.culture_packs`.
// Правило конфликта: два слоя переформулируют один вопрос → берём первый слой, второй становится вопросом
// сразу после него (прозвучат оба), id = "<id>-<слой>".
import type { Question, SpokenLang } from "@/lib/types";
import { GENERAL_QUESTIONS } from "./general/questions";
import { KORYO_PACK } from "./koryo/pack";
import type { CulturePack, PackLang, PackQuestion } from "./types";

export type { CulturePack, PackLang, PackOp, PackQuestion, PackText } from "./types";

/** Слои, которые есть в репозитории. Неизвестный id в culture_packs семьи пропускается. */
export const CULTURE_PACKS: Readonly<Record<string, CulturePack>> = {
  koryo: KORYO_PACK,
};

/** На каком языке задаём вопрос: корё мар — диалект, вопросы звучат по-русски (как сейчас). */
export function questionLang(spoken: SpokenLang): PackLang {
  return spoken === "kk" ? "kk" : "ru";
}

/** Применить слои к костяку. Бросает ошибку на битом пакете (нет якоря / id) — это ловят тесты пакетов. */
export function applyPacks(base: readonly PackQuestion[], layers: readonly CulturePack[]): PackQuestion[] {
  type Item = { q: PackQuestion; addedAfter?: string; rewordedBy?: string };
  const items: Item[] = base.map((q) => ({ q: { ...q, text: { ...q.text }, minimum: [...q.minimum] } }));
  const find = (id: string, layer: string) => {
    const i = items.findIndex((x) => x.q.id === id);
    if (i < 0) throw new Error(`Пакет ${layer}: нет вопроса ${id}`);
    return i;
  };
  const insertAfter = (anchor: string, layer: string, q: PackQuestion) => {
    if (items.some((x) => x.q.id === q.id)) throw new Error(`Пакет ${layer}: повтор id ${q.id}`);
    let i = find(anchor, layer) + 1;
    while (i < items.length && items[i]!.addedAfter === anchor) i++;
    items.splice(i, 0, { q, addedAfter: anchor });
  };

  for (const layer of layers) {
    for (const op of layer.ops) {
      switch (op.op) {
        case "add":
          insertAfter(op.after, layer.id, op.question);
          break;
        case "reword": {
          const item = items[find(op.id, layer.id)]!;
          if (item.rewordedBy) {
            const text = { ...item.q.text, ...op.text } as PackQuestion["text"];
            insertAfter(op.id, layer.id, { id: `${op.id}-${layer.id}`, block: item.q.block, text, minimum: op.minimum ?? item.q.minimum });
          } else {
            item.q = { ...item.q, text: { ...item.q.text, ...op.text }, minimum: op.minimum ? [...op.minimum] : item.q.minimum };
            item.rewordedBy = layer.id;
          }
          break;
        }
        case "minimum+": {
          const item = items[find(op.id, layer.id)]!;
          item.q = { ...item.q, minimum: [...item.q.minimum, ...op.add.filter((m) => !item.q.minimum.includes(m))] };
          break;
        }
        case "hide":
          items.splice(find(op.id, layer.id), 1);
          break;
      }
    }
  }
  return items.map((x) => x.q);
}

function toQuestion(q: PackQuestion): Question {
  return { id: q.id, block: q.block, ru: q.text.ru, ko: q.text.ko ?? "", ...(q.text.kk ? { kk: q.text.kk } : {}), minimum: q.minimum };
}

/**
 * Банк вопросов семьи. `packs` — families.culture_packs (general добавляется сам и всегда первым),
 * `spokenLang` — на каком языке рассказывают. У каждого вопроса должен быть текст на языке вопроса, иначе ошибка
 * (пакет не готов для этого языка — флаг включать рано).
 * resolveBank(["general", "koryo"], "ru") = сегодняшний банк V0 (content/questions/bank.ts → QUESTIONS).
 */
export function resolveBank(
  packs: readonly string[],
  spokenLang: SpokenLang,
  registry: Readonly<Record<string, CulturePack>> = CULTURE_PACKS,
  base: readonly PackQuestion[] = GENERAL_QUESTIONS,
): Question[] {
  const seen = new Set<string>();
  const layers: CulturePack[] = [];
  for (const id of packs) {
    if (id === "general" || seen.has(id)) continue;
    seen.add(id);
    const pack = registry[id];
    if (pack) layers.push(pack);
  }
  const lang = questionLang(spokenLang);
  const resolved = applyPacks(base, layers);
  const missing = resolved.filter((q) => !q.text[lang]?.trim()).map((q) => q.id);
  if (missing.length) throw new Error(`Банк (${["general", ...layers.map((l) => l.id)].join("+")}): нет текста «${lang}» у ${missing.join(", ")}`);
  return resolved.map(toQuestion);
}
