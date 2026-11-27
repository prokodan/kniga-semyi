// Банк вопросов из культурных пакетов (#230, docs/v2/LANGUAGES.md §2): resolveBank(packs, spokenLang) — чистая функция.
// general — костяк (всегда первым), слои применяются по порядку `families.culture_packs`.
// Правило конфликта: два слоя переформулируют один вопрос → берём первый слой, второй становится вопросом
// сразу после него (прозвучат оба), id = "<id>-<слой>". reword заменяет тексты вопроса целиком (#233).
import { DEFAULT_CULTURE_PACKS, type Question, type SpokenLang } from "@/lib/types";
import { GENERAL_QUESTIONS } from "./general/questions";
import { KORYO_PACK } from "./koryo/pack";
import { KZ_PACK } from "./kz/pack";
import { UA_PACK } from "./ua/pack";
import type { CulturePack, PackLang, PackQuestion } from "./types";

export type { CulturePack, PackLang, PackOp, PackQuestion, PackText } from "./types";

/** Слои, которые есть в репозитории. Неизвестный id в culture_packs семьи пропускается. */
// Порядок здесь = порядок вариантов «Кто ваша семья?» на /start (#233) и порядок слоёв, если выбрано несколько.
export const CULTURE_PACKS: Readonly<Record<string, CulturePack>> = {
  koryo: KORYO_PACK,
  // #231: глоссарий и родство для перевода ru ↔ kk; #233: вопросы, трудные темы, подсказки (черновик, #281)
  kz: KZ_PACK,
  // #233: каркас (контент Влада, #281)
  ua: UA_PACK,
};

/**
 * Пакеты семьи в каноническом виде: general первым, дальше известные слои без повторов в порядке семьи.
 * Неизвестный id пропускается (семья с пакетом, которого ещё нет в коде, слышит остальное).
 */
export function normalizePacks(packs: readonly string[] | null | undefined, registry: Readonly<Record<string, CulturePack>> = CULTURE_PACKS): string[] {
  const out = ["general"];
  for (const id of packs ?? []) if (id !== "general" && registry[id] && !out.includes(id)) out.push(id);
  return out;
}

/** Пакеты = сегодняшний продукт (general + koryo): банк V0, подсказки корё, корейская строка вопроса. */
export function isDefaultPacks(packs: readonly string[] | null | undefined): boolean {
  return normalizePacks(packs).join(",") === normalizePacks(DEFAULT_CULTURE_PACKS).join(",");
}

/** Слои семьи (без general) — объекты пакетов по порядку. */
export function packLayers(packs: readonly string[] | null | undefined): CulturePack[] {
  return normalizePacks(packs)
    .slice(1)
    .map((id) => CULTURE_PACKS[id]!);
}

/** #235 (древо): термины родства всех слоёв семьи — «нағашы ата» → «дедушка по матери». Первым — первый слой. */
export function packKinship(packs: readonly string[] | null | undefined): { term: string; relation: string; pack: string }[] {
  return packLayers(packs).flatMap((p) => (p.kinship ?? []).map((k) => ({ ...k, pack: p.id })));
}

/** Трудные темы слоёв семьи (только в hardship, не первыми — тест). */
export function packSensitive(packs: readonly string[] | null | undefined): { topic: string; questionIds: string[]; pack: string }[] {
  return packLayers(packs).flatMap((p) => (p.sensitive ?? []).map((s) => ({ topic: s.topic, questionIds: s.questionIds ?? [], pack: p.id })));
}

/** Правила обращения слоёв семьи (для вопросов и перевода). */
export function packTone(packs: readonly string[] | null | undefined): string[] {
  return packLayers(packs).flatMap((p) => p.tone ?? []);
}

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
            insertAfter(op.id, layer.id, { id: `${op.id}-${layer.id}`, block: item.q.block, text: { ...op.text }, minimum: op.minimum ? [...op.minimum] : [...item.q.minimum] });
          } else {
            // #233: тексты заменяются целиком — языки, которых нет в reword, у вопроса пропадают (types.ts)
            item.q = { ...item.q, text: { ...op.text }, minimum: op.minimum ? [...op.minimum] : item.q.minimum };
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
