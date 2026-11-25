// Шаг 1: расшифровка аудио. Текстовый ответ (transcript уже есть) этот шаг пропускает — решает движок.
import { reconcileNames } from "@/lib/interview/names";
import type { StepFn } from "./context";
import { StepError } from "./context";

const MAX_SEC = 600; // лимит входа transcribe в lib/ai/types.ts

/** Длительность, если запись не сохранила duration_sec: грубо по размеру (opus/aac ≈ 4–16 КБ/с). */
export function estimateDurationSec(bytes: number): number {
  return Math.min(MAX_SEC, Math.max(1, Math.round(bytes / 8000)));
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
  const out = await ai.run(
    "transcribe",
    { audioBase64: audio.base64, mimeType: audio.mimeType, durationSec, languageHint: "ru", ...(hints?.length ? { hints } : {}) },
    { storyId: story.id, deadline },
  );
  const heard = out.text.trim();
  if (!heard) throw new StepError("В записи не удалось разобрать речь — попробуйте записать ближе к телефону");
  // #102: сверка со словарём семьи и глоссарием — «опаса уле» → «апа Сауле», «кончана» → «кочжана»
  const text = hints?.length ? reconcileNames(heard, hints).text : heard;
  return duration ? { transcript: text } : { transcript: text, duration_sec: durationSec };
};
