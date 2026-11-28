import "server-only";
// Сохранение правки черновика (I6) и перезапуск только перевода.
// Конвейер (I2) не меняем: проверка ссылки семьи и текущие поля — pipeline.view(),
// запись правки — та же строка stories (Supabase или общая память процесса), перевод — runStep(id, "translate").
import { getDbOrNull } from "@/lib/db";
import { MemoryInterviewRepo } from "@/lib/interview/repo";
import { dropStaleTranslations, pipeline, PipelineError, runStep, STATUS_MESSAGE } from "@/lib/pipeline";
import type { Story } from "@/lib/types";
import { draftChanged, quoteMatch, type DraftFields, type DraftSaveResult } from "./draft";

type DraftPatch = Pick<Story, "title" | "quote" | "text_ru" | "title_ko" | "quote_ko" | "text_ko" | "status" | "error">;

const g = globalThis as { __interviewMemoryRepo?: MemoryInterviewRepo };

async function writeStory(storyId: string, patch: DraftPatch): Promise<void> {
  const db = getDbOrNull();
  if (db) {
    // #246: правка семьи → story_texts.origin = family в той же записи (зеркало читает заголовок, миграция 20261128213000)
    const { error } = await db
      .from("stories")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", storyId)
      .setHeader("x-text-origin", "family");
    if (error) throw new Error(`сохранение правки: ${error.message}`);
    return;
  }
  // Локально без базы — та же карта историй, что у конвейера и интервью-агента (lib/pipeline/index.ts).
  g.__interviewMemoryRepo ??= new MemoryInterviewRepo();
  const s = g.__interviewMemoryRepo.stories.get(storyId);
  if (!s) throw new PipelineError("not_found", "История не найдена");
  Object.assign(s, patch, { updated_at: new Date().toISOString() });
}

export class DraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftError";
  }
}

export async function saveDraft(storyId: string, token: string, fields: DraftFields): Promise<DraftSaveResult> {
  const story = await pipeline.view(storyId, { token }); // not_found / forbidden → PipelineError
  if (story.isFollowup) throw new DraftError("Это ответ на уточнение — правьте основную главу");
  if (!story.text_ru || story.status === "transcribing" || story.status === "editing") {
    throw new DraftError("Глава ещё собирается — откройте правку, когда она будет готова");
  }

  // Цитата расходится с текстом только написанием («У штабе» / «Уштобе») — не предупреждение.
  const match = quoteMatch(fields.quote, fields.text_ru);
  const quoteWarning = match === "missing";
  const quoteSpelling = match === "spelling";
  if (!draftChanged(story, fields)) {
    return { storyId, changed: false, quoteWarning, quoteSpelling, status: story.status, done: story.done, queued: false, message: "Правок нет — всё как было" };
  }

  // Новый русский текст → старый перевод больше не верен: очищаем KR, следующий шаг по данным — translate.
  await writeStory(storyId, {
    title: fields.title,
    quote: fields.quote || null,
    text_ru: fields.text_ru,
    title_ko: null,
    quote_ko: null,
    text_ko: null,
    status: "translating",
    error: null,
  });
  // #298: и казахский перевод (story_texts) — заново, даже если поменялись только заголовок или цитата
  try {
    await dropStaleTranslations(storyId);
  } catch (e) {
    console.warn("[draft] старые переводы", e instanceof Error ? e.message : e);
  }

  try {
    const res = await runStep(storyId, "translate");
    return {
      storyId,
      changed: true,
      quoteWarning,
      quoteSpelling,
      status: res.status,
      done: res.done,
      queued: res.queued,
      retryInMinutes: res.retryInMinutes,
      message: res.done ? "Сохранили, перевод обновлён" : res.message,
    };
  } catch (e) {
    // Правка уже сохранена; перевод догонит экран главы (он сам двигает /process).
    console.error("[draft] translate", e instanceof Error ? e.message : e);
    return { storyId, changed: true, quoteWarning, quoteSpelling, status: "translating", done: false, queued: true, message: STATUS_MESSAGE.translating };
  }
}
