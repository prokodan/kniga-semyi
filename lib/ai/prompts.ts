import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AiStep } from "./types";
import { sha256 } from "./util";

// Промпты лежат в prompts/<step>.md — их правит Влад без агента (V1).
// Версия промпта входит в ключ кэша: правка промпта = новый результат, старый кэш не мешает.

export interface LoadedPrompt {
  text: string;
  version: string;
}

const cache = new Map<AiStep, LoadedPrompt>();

export async function loadPrompt(step: AiStep): Promise<LoadedPrompt> {
  const hit = cache.get(step);
  if (hit && process.env.NODE_ENV === "production") return hit;
  const file = path.join(process.cwd(), "prompts", `${step}.md`);
  const text = await readFile(file, "utf8");
  const loaded = { text, version: sha256(text).slice(0, 12) };
  cache.set(step, loaded);
  return loaded;
}
