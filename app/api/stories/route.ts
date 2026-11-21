import { z } from "zod";
import { LIFE_BLOCKS } from "@/lib/types";
import { AccessError, findStoryteller, getFamilyStore, isOwnAudioPath } from "@/lib/db/access";
import { errorResponse, familyToken, ok, readJson, requireFamily } from "../_family/http";

export const dynamic = "force-dynamic";

const Body = z.object({
  storytellerId: z.string().min(1),
  path: z.string().min(1).max(300),
  questionId: z.string().max(80).nullish(),
  block: z.enum(LIFE_BLOCKS).nullish(),
  durationSec: z.number().min(0).max(60 * 60).nullish(),
  sessionId: z.string().max(80).nullish(),
  /** Ответ на уточнение агента: id основной истории вопроса (AnswerResult.followup.storyId) */
  parentStoryId: z.string().max(80).nullish(),
});

// POST /api/stories — аудио уже в Storage → строка stories со status 'uploaded'.
// Тело: { token, storytellerId, path, questionId?, block?, durationSec?, sessionId?, parentStoryId? }. Ответ 201: { storyId, status }.
// Нужна запись согласия рассказчика (иначе 409 consent_required). Дальше клиент гоняет конвейер I2:
// POST /api/stories/:id/process по шагу, пока next !== null и queued === false.
export async function POST(req: Request) {
  try {
    const raw = await readJson(req);
    const view = await requireFamily(familyToken(req, raw));
    const body = Body.parse(raw ?? {});
    const st = findStoryteller(view, body.storytellerId);
    if (!st.consent_at) throw new AccessError("consent_required", "Сначала нужно записать согласие рассказчика");
    if (!isOwnAudioPath(body.path, view.family.id, st.id, "story")) throw new AccessError("bad_request", "Неверный путь записи");
    const parent = body.parentStoryId ? view.stories.find((s) => s.id === body.parentStoryId) : null;
    if (body.parentStoryId && (!parent || parent.storyteller_id !== st.id)) throw new AccessError("bad_request", "Основная история не найдена");

    const story = await getFamilyStore().createStory(view.family.id, {
      storyteller_id: st.id,
      audio_path: body.path,
      question_id: body.questionId ?? null,
      block: body.block ?? null,
      duration_sec: body.durationSec != null ? Math.round(body.durationSec * 100) / 100 : null,
      session_id: body.sessionId ?? null,
      parent_story_id: parent?.id ?? null,
    });

    return ok({ storyId: story.id, status: story.status }, 201);
  } catch (e) {
    return errorResponse(e);
  }
}
