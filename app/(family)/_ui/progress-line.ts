// #101: строка прогресса интервью под полосой разделов — чистая функция, её проверяют тесты.
import type { LifeBlock } from "@/lib/types";

/** То, что отдаёт движок интервью в `progress` (lib/interview/engine.ts → Progress); всё необязательно — старые ответы. */
export interface InterviewProgressView {
  doneBlocks?: LifeBlock[];
  block?: { id: LifeBlock; position: number; total: number } | null;
  followups?: { asked: number; max: number };
}

/**
 * «Вопрос 2 из 5 в разделе „Детство“ · уточнение 1 из 3».
 * Для уточнения без номера (переспрос имени) — просто «· уточнение». Нет данных — null (строку не показываем).
 */
export function progressLine(p: InterviewProgressView | null | undefined, kind: "question" | "followup", blockTitle: string): string | null {
  const b = p?.block;
  const parts: string[] = [];
  if (b && b.total > 0) parts.push(`Вопрос ${b.position} из ${b.total} в разделе «${blockTitle}»`);
  else parts.push(`Раздел «${blockTitle}»`);
  if (kind === "followup") {
    const f = p?.followups;
    parts.push(f && f.asked > 0 ? `уточнение ${Math.min(f.asked, f.max)} из ${f.max}` : "уточнение");
  }
  return parts.join(" · ");
}

/** Состояние раздела в полосе: пройден ✓, текущий (жёлтый акцент), будущий (приглушённо). */
export function blockState(id: LifeBlock, order: readonly LifeBlock[], current: LifeBlock | null, done: readonly LifeBlock[]): "done" | "current" | "future" {
  if (id === current) return "current";
  if (done.includes(id)) return "done";
  // Без данных движка (запасной путь по банку) разделы до текущего считаем пройденными: идём строго по порядку.
  if (current && done.length === 0 && order.indexOf(id) < order.indexOf(current)) return "done";
  return "future";
}

/** Запасной путь без движка (идём по банку сами): прогресс по локальному списку пройденных вопросов. */
export function localProgress(
  questions: readonly { id: string; block: LifeBlock }[],
  done: ReadonlySet<string>,
  current: { id: string; block: LifeBlock },
): InterviewProgressView {
  const inBlock = questions.filter((q) => q.block === current.block);
  const closed = inBlock.filter((q) => q.id !== current.id && done.has(q.id)).length;
  const blocks = [...new Set(questions.map((q) => q.block))];
  return {
    doneBlocks: blocks.filter((b) => questions.filter((q) => q.block === b).every((q) => done.has(q.id))),
    block: { id: current.block, position: Math.min(closed + 1, inBlock.length), total: inBlock.length },
    followups: { asked: 0, max: 3 },
  };
}
