// Банк вопросов для интервью-агента — тонкий адаптер над content/questions.
//
// Агент НЕ знает ни количества вопросов, ни их id: всё берётся из банка во время работы.
// Поэтому когда V0 (Влад) заменит заглушку в content/questions/bank.ts на полный банк
// (8 блоков × 5 вопросов) — здесь и в остальном lib/interview ничего править не нужно.
// Для тестов и симулятора (I15) банк можно передать свой: createQuestionBank(questions).
import { BLOCKS, DEFAULT_MINIMUM } from "@/content/questions/blocks";
import { QUESTIONS } from "@/content/questions/bank";
import { LIFE_BLOCKS, type LifeBlock, type Question } from "@/lib/types";

export interface QuestionBank {
  /** Все вопросы в порядке показа: по блокам карты жизни, внутри блока — как в банке. */
  all(): readonly Question[];
  get(id: string): Question | undefined;
  inBlock(block: LifeBlock): readonly Question[];
  first(): Question;
  blockTitle(block: LifeBlock): { ru: string; ko: string };
}

export function createQuestionBank(
  questions: readonly Question[] = QUESTIONS,
  blocks: readonly { id: LifeBlock; ru: string; ko: string }[] = BLOCKS,
): QuestionBank {
  if (questions.length === 0) throw new Error("Банк вопросов пуст");
  const order = new Map(LIFE_BLOCKS.map((b, i) => [b, i]));
  const ids = new Set<string>();
  const normalized = questions.map((q, idx) => {
    if (ids.has(q.id)) throw new Error(`Банк вопросов: повтор id ${q.id}`);
    ids.add(q.id);
    // Пустой минимум не должен ломать проверку полноты — берём общий по умолчанию.
    return { q: { ...q, minimum: q.minimum.length > 0 ? q.minimum : DEFAULT_MINIMUM }, idx };
  });
  const sorted = normalized
    .sort((a, b) => (order.get(a.q.block) ?? 99) - (order.get(b.q.block) ?? 99) || a.idx - b.idx)
    .map((x) => x.q);
  const byId = new Map(sorted.map((q) => [q.id, q]));
  const titles = new Map(blocks.map((b) => [b.id, { ru: b.ru, ko: b.ko }]));

  return {
    all: () => sorted,
    get: (id) => byId.get(id),
    inBlock: (block) => sorted.filter((q) => q.block === block),
    first: () => sorted[0]!,
    blockTitle: (block) => titles.get(block) ?? { ru: block, ko: block },
  };
}

let defaultBank: QuestionBank | null = null;
/** Банк из content/questions (заглушка W0 сейчас, полный V0 потом). */
export function getQuestionBank(): QuestionBank {
  defaultBank ??= createQuestionBank();
  return defaultBank;
}
