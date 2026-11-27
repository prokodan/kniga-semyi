import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AiStep } from "./types";
import { sha256 } from "./util";

// Промпты лежат в prompts/<step>.md — их правит Влад без агента (V1).
// Версия промпта входит в ключ кэша: правка промпта = новый результат, старый кэш не мешает.
// Исключение — шаги оценки качества (I11): их промпты лежат рядом с eval, в eval/<step>.md.

/** Шаги, чьи промпты живут в eval/ (оценка качества, в продуктовый конвейер не входят). */
export const EVAL_PROMPT_STEPS: readonly AiStep[] = ["judge", "back_translate"];

/**
 * #230: перевод — свой промпт на каждый язык книги: prompts/translate.<to>.md (ru → ko — translate.ko.md, бывший
 * translate.md без изменений текста, поэтому версия и кэш прежние). #231: ru → kk — translate.kk.md, kk → ru —
 * translate.ru.md; какой взять — по `to` из входа (promptVariant).
 * Нет translate.<to>.md (дерево «до» в eval собрано из промптов базовой ветки) — prompts/translate.md.
 */
export const DEFAULT_TRANSLATE_TO = "ko";

/**
 * Вариант промпта по входу шага: перевод — язык `to` (нет — ko, как до v2); completeness с `next` (#105 п. 1,
 * флаг lang_kk) — completeness.next.md; transcribe с kk в `spokenLangs` (#300) — transcribe.kk.md; judge с `golden` (#256) — eval/judge.golden.md. undefined — обычный prompts/<step>.md (версия и кэш как раньше).
 */
export function promptVariant(step: AiStep, input: unknown): string | undefined {
  const o = (input && typeof input === "object" ? input : {}) as { to?: unknown; next?: unknown; golden?: unknown; spokenLangs?: unknown };
  // #300 (флаг spoken_kk): рассказ с казахским — prompts/transcribe.kk.md; ru + корё мар — transcribe.md, как раньше
  if (step === "transcribe" && Array.isArray(o.spokenLangs) && o.spokenLangs.includes("kk")) return "kk";
  if (step === "translate") return typeof o.to === "string" ? o.to : DEFAULT_TRANSLATE_TO;
  if (step === "completeness" && o.next) return "next";
  if (step === "judge" && o.golden) return "golden"; // #256: eval/judge.golden.md
  return undefined;
}

export function promptPath(step: AiStep, root = process.cwd(), variant?: string): string {
  const dir = EVAL_PROMPT_STEPS.includes(step) ? "eval" : "prompts";
  const v = step === "translate" ? (variant ?? DEFAULT_TRANSLATE_TO) : variant;
  if (v && /^[a-z]{2,8}$/.test(v)) {
    const byVariant = path.join(root, dir, `${step}.${v}.md`);
    if (existsSync(byVariant)) return byVariant;
  }
  return path.join(root, dir, `${step}.md`);
}

export interface LoadedPrompt {
  text: string;
  version: string;
}

const cache = new Map<string, LoadedPrompt>();

export async function loadPrompt(step: AiStep, variant?: string): Promise<LoadedPrompt> {
  const key = `${step}:${variant ?? ""}`;
  const hit = cache.get(key);
  if (hit && process.env.NODE_ENV === "production") return hit;
  const text = await readFile(promptPath(step, process.cwd(), variant), "utf8");
  const loaded = { text, version: sha256(text).slice(0, 12) };
  cache.set(key, loaded);
  return loaded;
}
