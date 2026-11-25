import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AiStep } from "./types";
import { sha256 } from "./util";

// Промпты лежат в prompts/<step>.md — их правит Влад без агента (V1).
// Версия промпта входит в ключ кэша: правка промпта = новый результат, старый кэш не мешает.
// Исключение — шаги оценки качества (I11): их промпты лежат рядом с eval, в eval/<step>.md.

/** Шаги, чьи промпты живут в eval/ (оценка качества, в продуктовый конвейер не входят). */
export const EVAL_PROMPT_STEPS: readonly AiStep[] = ["judge", "back_translate"];

export function promptPath(step: AiStep, root = process.cwd()): string {
  const dir = EVAL_PROMPT_STEPS.includes(step) ? "eval" : "prompts";
  return path.join(root, dir, `${step}.md`);
}

export interface LoadedPrompt {
  text: string;
  version: string;
}

const cache = new Map<AiStep, LoadedPrompt>();

export async function loadPrompt(step: AiStep): Promise<LoadedPrompt> {
  const hit = cache.get(step);
  if (hit && process.env.NODE_ENV === "production") return hit;
  const text = await readFile(promptPath(step), "utf8");
  const loaded = { text, version: sha256(text).slice(0, 12) };
  cache.set(step, loaded);
  return loaded;
}
