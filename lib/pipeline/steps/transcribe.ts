// Шаг 1: расшифровка аудио. Текстовый ответ (transcript уже есть) этот шаг пропускает — решает движок.
import { KZ_HINTS_KK, KZ_HINTS_RU_WORDS } from "@/content/packs/kz/pack";
import type { AiInput } from "@/lib/ai/types";
import { reconcileNames } from "@/lib/interview/names";
import type { SpokenLang } from "@/lib/types";
import type { StepFn } from "./context";
import { StepError } from "./context";

const MAX_SEC = 600; // лимит входа transcribe в lib/ai/types.ts

/** Длительность, если запись не сохранила duration_sec: грубо по размеру (opus/aac ≈ 4–16 КБ/с). */
export function estimateDurationSec(bytes: number): number {
  return Math.min(MAX_SEC, Math.max(1, Math.round(bytes / 8000)));
}

const MAX_HINTS = 150; // лимит hints во входе transcribe (lib/ai/types.ts)

/**
 * #300 (флаг spoken_kk): что добавить ко входу расшифровки по языку рассказа. Нет kk в языке рассказа (ru, ru + корё мар,
 * флаг выключен) — null: вход, промпт и ключ кэша ровно как до #300. С kk: `spokenLangs` (→ prompts/transcribe.kk.md),
 * languageHint kk (по-казахски) или mixed (по-русски с казахскими словами), подсказки — казахские написания пакета kz
 * вместо русских написаний казахских слов («нағашы», а не «нагашы»); русские названия мест остаются — по-русски сказанное
 * пишется по-русски. Сверка со словарём (reconcileNames) — по прежним подсказкам: она знает лишь русские буквы, слова
 * с казахскими буквами не трогает (тест).
 */
export function spokenInput(
  langs: readonly SpokenLang[] | null | undefined,
  hints: readonly string[] | undefined,
): { languageHint: "kk" | "mixed"; spokenLangs: SpokenLang[]; hints: string[]; reconcile: string[] } | null {
  if (!langs?.includes("kk")) return null;
  const ruSpellings = new Set(KZ_HINTS_RU_WORDS);
  const own = (hints ?? []).filter((h) => !ruSpellings.has(h));
  return {
    languageHint: langs.includes("ru") ? "mixed" : "kk",
    spokenLangs: [...langs],
    hints: [...new Set([...own, ...KZ_HINTS_KK])].slice(0, MAX_HINTS),
    reconcile: [...(hints ?? [])],
  };
}

export const transcribe: StepFn = async ({ story, ai, repo, deadline }) => {
  if (!story.audio_url) throw new StepError("Нет ни записи, ни текста ответа — запишите рассказ ещё раз");
  const duration = story.duration_sec ? Number(story.duration_sec) : null;
  if (duration !== null && duration > MAX_SEC) {
    throw new StepError("Запись длиннее 10 минут — пожалуйста, разделите рассказ на части");
  }
  let audio;
  try {
    audio = await repo.loadAudio(story.audio_url);
  } catch (e) {
    throw new StepError(`Не удалось открыть запись: ${(e as Error).message}`);
  }
  const durationSec = duration && duration > 0 ? duration : estimateDurationSec(audio.bytes);
  const hints = repo.nameHints ? await repo.nameHints(story) : undefined;
  // #300: язык рассказа — только с флагом spoken_kk (repo вернёт null без флага); сбой — как до #300
  const spoken = spokenInput(repo.spokenLangs ? await repo.spokenLangs(story).catch(() => null) : null, hints);
  const input: AiInput<"transcribe"> = spoken
    ? { audioBase64: audio.base64, mimeType: audio.mimeType, durationSec, languageHint: spoken.languageHint, hints: spoken.hints, spokenLangs: spoken.spokenLangs }
    : { audioBase64: audio.base64, mimeType: audio.mimeType, durationSec, languageHint: "ru", ...(hints?.length ? { hints } : {}) };
  const out = await ai.run("transcribe", input, { storyId: story.id, familyId: story.family_id, deadline });
  const heard = out.text.trim();
  if (!heard) throw new StepError("В записи не удалось разобрать речь — попробуйте записать ближе к телефону");
  // #102: сверка со словарём семьи и глоссарием — «опаса уле» → «апа Сауле», «кончана» → «кочжана»
  const known = spoken ? spoken.reconcile : hints;
  const text = known?.length ? reconcileNames(heard, known).text : heard;
  return duration ? { transcript: text } : { transcript: text, duration_sec: durationSec };
};
