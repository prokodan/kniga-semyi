// #313 (флаг lang_kk): перевод ru → kk с одним повтором по замечанию. Общий для конвейера (steps/translate.ts → toKazakh)
// и симулятора eval (eval/sim/run.ts) — иначе eval покажет не то, что на проде.
//   1) перевод → исправления без ИИ (finishKk: алфавит, русские служебные слова, обращение к внукам, имена);
//   2) остались хангыль / слова латиницей (заглавные: имена, аббревиатуры) / русские слова — ОДИН повтор с `retry_note`:
//      вход другой → свой ключ ai_cache (повтор с тем же входом вернул бы тот же ответ из кэша);
//   3) берём попытку, где осталось меньше; повтор упал (ИИ недоступен, время шага) — остаётся первая попытка.
// RU + KR сюда не попадает: ru → ko переводит toKorean без retry_note (вход и ключ кэша прежние).
import { translateInput, type AiInput, type AiOutput } from "@/lib/ai/types";
import { finishKk, kkLeftCount, kkRetryNote, type KkFix, type KkResult } from "./kk";
import type { NamePair } from "./names";

export type KkTranslateRun = (input: AiInput<"translate">) => Promise<AiOutput<"translate">>;

export interface KkTranslated {
  res: KkResult<AiOutput<"translate">>;
  /** Было ли замечание и повтор; kept — какую попытку оставили */
  retry: { note: string; kept: "first" | "retry"; error?: string } | null;
}

export async function translateKk(
  run: KkTranslateRun,
  src: { text_ru: string; title: string; quote: string },
  names: NamePair[],
  required: NamePair[],
): Promise<KkTranslated> {
  const base = { text_ru: src.text_ru, title: src.title, quote: src.quote, ...(names.length ? { names } : {}) };
  const first = finishKk(await run(translateInput("ru", "kk", base)), src.text_ru, required);
  const note = kkRetryNote(first.left);
  if (!note) return { res: first, retry: null };
  try {
    const again = finishKk(await run(translateInput("ru", "kk", { ...base, retry_note: note })), src.text_ru, required);
    if (kkLeftCount(again.left) < kkLeftCount(first.left)) return { res: again, retry: { note, kept: "retry" } };
    return { res: first, retry: { note, kept: "first" } };
  } catch (e) {
    return { res: first, retry: { note, kept: "first", error: (e as Error).message.slice(0, 120) } };
  }
}

/** Строка в лог без текста главы: что исправлено, что осталось, был ли повтор. */
export function kkLogLines(id: string, t: KkTranslated): { info: string[]; warn: string[] } {
  const { res, retry } = t;
  const info: string[] = [];
  const warn: string[] = [];
  const fx = (f: KkFix) => `${f.kind} ${f.from} → ${f.to}`;
  if (res.fixed.length) info.push(`[pipeline] kk ${id}: ${res.fixed.map(fx).join(", ")}`);
  if (retry) info.push(`[pipeline] kk ${id}: повтор с замечанием (#313) — оставлена ${retry.kept === "retry" ? "вторая" : "первая"} попытка${retry.error ? ` (повтор: ${retry.error})` : ""}`);
  if (res.left.latin.length || res.left.hangul) warn.push(`[pipeline] kk ${id}: не по алфавиту — ${[...res.left.latin, res.left.hangul ? "хангыль" : ""].filter(Boolean).join(", ")}`);
  if (res.left.russian.length) warn.push(`[pipeline] kk ${id}: русские слова — ${res.left.russian.length}`);
  if (res.left.style.length) warn.push(`[pipeline] kk ${id}: обращение к внукам вперемешку, абз. ${res.left.style.map((m) => m.paragraph).join(", ")}`);
  return { info, warn };
}
