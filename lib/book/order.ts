// Порядок глав (книга и страница семьи): разделы карты жизни как в content/questions/blocks.ts
// (корни → детство → юность → …), внутри раздела — по времени записи. Без server-only: видит и страница.
import { BLOCKS } from "@/content/questions/blocks";
import type { LifeBlock, Story } from "@/lib/types";

type Orderable = Pick<Story, "block" | "created_at">;

/** Номер раздела; без раздела — в конце. */
export function blockIndex(b: LifeBlock | null | undefined): number {
  const i = BLOCKS.findIndex((x) => x.id === b);
  return i < 0 ? BLOCKS.length : i;
}

/** Разделы карты жизни → время записи. Новый массив, исходный не меняется. */
export function orderByLife<T extends Orderable>(stories: readonly T[]): T[] {
  return [...stories].sort((a, b) => blockIndex(a.block) - blockIndex(b.block) || a.created_at.localeCompare(b.created_at));
}

export interface Section<T> {
  block: LifeBlock | null;
  ru: string;
  ko: string;
  items: T[];
}

/** Сгруппировать по разделам в порядке карты жизни; пустые разделы не показываем. */
export function groupBySection<T extends Orderable>(stories: readonly T[]): Section<T>[] {
  const out: Section<T>[] = [];
  for (const s of orderByLife(stories)) {
    const last = out.at(-1);
    if (last && last.block === (s.block ?? null)) last.items.push(s);
    else {
      const b = BLOCKS.find((x) => x.id === s.block);
      out.push({ block: s.block ?? null, ru: b?.ru ?? "Другие рассказы", ko: b?.ko ?? "다른 이야기", items: [s] });
    }
  }
  return out;
}
