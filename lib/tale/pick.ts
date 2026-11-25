// Какие главы идут в сказку (I8): чистая логика, без базы — покрыта тестами.
import { LIFE_BLOCKS, type Story } from "@/lib/types";
import { TALE_MAX_STORIES } from "./types";

export type TaleStory = Pick<Story, "id" | "block" | "status" | "parent_story_id" | "text_ru" | "title" | "sort_order" | "created_at">;

/** Самые «сказочные» блоки — первыми: детство, традиции, корни; трудные времена — в конце. */
const TALE_BLOCK_ORDER = ["childhood", "traditions", "roots", "youth", "love", "work", "legacy", "hardship"] as const;
/** Длинную главу обрезаем: сказке нужны детали, а не весь текст (и токены дешевле). */
const MAX_CHARS = 1800;

export function isTaleStory(s: TaleStory): boolean {
  return s.status === "ready" && !s.parent_story_id && Boolean(s.text_ru?.trim());
}

function rank(block: Story["block"]): number {
  const i = (TALE_BLOCK_ORDER as readonly string[]).indexOf(block ?? "");
  return i === -1 ? TALE_BLOCK_ORDER.length : i;
}

/**
 * 2–5 готовых глав: сначала по одной из разных блоков (в «сказочном» порядке), потом добираем остальными.
 * Внутри блока — по sort_order и времени записи. Порядок в ответе — порядок жизни (LIFE_BLOCKS).
 */
export function pickTaleStories<T extends TaleStory>(stories: T[], max = TALE_MAX_STORIES): T[] {
  const ready = stories
    .filter(isTaleStory)
    .sort((a, b) => rank(a.block) - rank(b.block) || (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9) || a.created_at.localeCompare(b.created_at));
  const seen = new Set<string>();
  const first: T[] = [];
  const rest: T[] = [];
  for (const s of ready) {
    const key = s.block ?? `none-${s.id}`;
    if (seen.has(key)) rest.push(s);
    else {
      seen.add(key);
      first.push(s);
    }
  }
  const chosen = [...first, ...rest].slice(0, max);
  const life = (b: Story["block"]) => {
    const i = (LIFE_BLOCKS as readonly string[]).indexOf(b ?? "");
    return i === -1 ? LIFE_BLOCKS.length : i;
  };
  return chosen.sort((a, b) => life(a.block) - life(b.block) || a.created_at.localeCompare(b.created_at));
}

/** Вход шага tale: заголовок и (обрезанный) текст главы. */
export function taleInputStories(stories: TaleStory[]): { title: string; text_ru: string }[] {
  return stories.map((s) => {
    const text = (s.text_ru ?? "").trim();
    return { title: (s.title ?? "").trim() || "Из жизни", text_ru: text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}…` : text };
  });
}

/** Имя внука: коротко и без разметки; пусто → null. */
export function cleanChildName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const v = name.replace(/[<>{}"\n\r\t]/g, "").trim().slice(0, 40);
  return v || null;
}
