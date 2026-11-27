// #232: наборы текстов для ссылок носителей. ТОЛЬКО вымышленные тексты из репозитория:
//   • demo — главы демо-семей (Ким Чер Су = eval-персонаж kim, Ли Нина — пример киоска) и запас сцены, ru → ko;
//   • bank — тексты вопросов банка (content/packs), режим «вопросы»;
//   • eval:<имя> — главы прогона eval по вымышленным персонажам (eval/reviews/sets).
// Главы живых семей сюда не попадают никогда: модуль не читает базу (тест sets.test.ts проверяет и это).
import { CULTURE_PACKS, applyPacks, type CulturePack } from "@/content/packs";
import { GENERAL_QUESTIONS } from "@/content/packs/general/questions";
import { REVIEW_EVAL_SETS } from "@/eval/reviews/sets";
import { DEMO_KIOSK_STORY_SEEDS, DEMO_STAGE_RESERVE, DEMO_STORY_SEEDS } from "@/fixtures/demo/family";
import type { ReviewItem, ReviewMode, ReviewPair } from "@/lib/types";
import { pairLangs } from "./core";

export type ItemSeed = Omit<ReviewItem, "id" | "link_id">;

export interface ReviewSet {
  id: string;
  label: string;
  mode: ReviewMode;
  pairs: readonly ReviewPair[];
  /** Тексты набора для пары; пусто — для пары текстов ещё нет */
  items(pair: ReviewPair): ItemSeed[];
}

const DEMO_PROMPT = "демо · вычитано #122";

function demoItems(pair: ReviewPair): ItemSeed[] {
  if (pair !== "ru-ko") return [];
  const chapters = [
    ...DEMO_STORY_SEEDS.map((s) => ({ persona: "demo:kim", s })),
    ...DEMO_KIOSK_STORY_SEEDS.map((s) => ({ persona: "demo:li", s })),
    { persona: "demo:reserve", s: DEMO_STAGE_RESERVE },
  ];
  return chapters.map(({ persona, s }, position): ItemSeed => ({
    position,
    kind: "chapter",
    source_lang: "ru",
    target_lang: "ko",
    title: s.edit.title,
    source_text: s.edit.text_ru,
    model_text: s.translate.text_ko,
    prompt_version: DEMO_PROMPT,
    persona,
  }));
}

function bankItems(pair: ReviewPair): ItemSeed[] {
  const { from, to } = pairLangs(pair);
  if (from !== "ru") return [];
  // ko — банк корё-сарам (general + koryo, как у семей сегодня); kk — общий костяк (+ слой kz, когда появится)
  const layers = to === "ko" ? [CULTURE_PACKS.koryo] : [CULTURE_PACKS.kz];
  const qs = applyPacks(
    GENERAL_QUESTIONS,
    layers.filter((l): l is CulturePack => l !== undefined),
  );
  return qs
    .filter((q) => q.text.ru?.trim() && q.text[to]?.trim())
    .map((q, position): ItemSeed => ({
      position,
      kind: "question",
      source_lang: from,
      target_lang: to,
      title: q.id,
      source_text: q.text.ru,
      model_text: q.text[to]!,
      prompt_version: "content/packs",
      persona: to === "ko" ? "bank:koryo" : "bank:general",
    }));
}

export const REVIEW_SETS: readonly ReviewSet[] = [
  { id: "demo", label: "Демо: семья Ким, киоск Ли, запас сцены", mode: "texts", pairs: ["ru-ko"], items: demoItems },
  { id: "bank", label: "Вопросы банка (content/packs)", mode: "questions", pairs: ["ru-ko", "ru-kk"], items: bankItems },
  ...REVIEW_EVAL_SETS.map(
    (f): ReviewSet => ({
      id: `eval:${f.name}`,
      label: `Прогон eval ${f.created}: ${[...new Set(f.items.map((i) => i.persona))].join(", ")}`,
      mode: "texts",
      pairs: [f.pair as ReviewPair],
      items: (pair) => {
        if (pair !== f.pair) return [];
        const { from, to } = pairLangs(pair);
        return f.items.map((i, position): ItemSeed => ({
          position,
          kind: "chapter",
          source_lang: from,
          target_lang: to,
          title: i.title,
          source_text: i.source,
          model_text: i.model,
          prompt_version: i.prompt_version,
          persona: i.persona,
        }));
      },
    }),
  ),
];

export function findSet(id: string): ReviewSet | undefined {
  return REVIEW_SETS.find((s) => s.id === id);
}

/** Сколько текстов есть в наборе для пары и режима — для формы «Новая ссылка». */
export function setOptions(): { id: string; label: string; mode: ReviewMode; pair: ReviewPair; count: number }[] {
  return REVIEW_SETS.flatMap((s) => s.pairs.map((pair) => ({ id: s.id, label: s.label, mode: s.mode, pair, count: s.items(pair).length })));
}
