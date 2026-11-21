import { after } from "next/server";
import { z } from "zod";
import { LIFE_BLOCKS } from "@/lib/types";
import { AccessError, findStoryteller, getFamilyStore, isOwnAudioPath } from "@/lib/db/access";
import { errorResponse, familyToken, ok, readJson, requireFamily } from "../_family/http";

export const dynamic = "force-dynamic";

/**
 * Запуск конвейера I2 после загрузки. Маршрута POST /api/stories/[id]/process в main пока нет:
 * вызов идёт «на удачу» после ответа (after), 404 / ошибка — тихо в лог, история остаётся `uploaded`.
 * Когда I2 появится — заработает без правки этого файла. Выключатель на случай проблем — здесь.
 */
const PIPELINE_AUTOSTART = true;

const Body = z.object({
  storytellerId: z.string().min(1),
  path: z.string().min(1).max(300),
  questionId: z.string().max(80).nullish(),
  block: z.enum(LIFE_BLOCKS).nullish(),
  durationSec: z.number().min(0).max(60 * 60).nullish(),
  sessionId: z.string().max(80).nullish(),
});

// POST /api/stories — аудио уже в Storage → строка stories со status 'uploaded'.
// Тело: { token, storytellerId, path, questionId?, block?, durationSec?, sessionId? }. Ответ 201: { storyId, status }.
// Нужна запись согласия рассказчика (иначе 409 consent_required).
export async function POST(req: Request) {
  try {
    const raw = await readJson(req);
    const token = familyToken(req, raw);
    const view = await requireFamily(token);
    const body = Body.parse(raw ?? {});
    const st = findStoryteller(view, body.storytellerId);
    if (!st.consent_at) throw new AccessError("consent_required", "Сначала нужно записать согласие рассказчика");
    if (!isOwnAudioPath(body.path, view.family.id, st.id, "story")) throw new AccessError("bad_request", "Неверный путь записи");

    const story = await getFamilyStore().createStory(view.family.id, {
      storyteller_id: st.id,
      audio_path: body.path,
      question_id: body.questionId ?? null,
      block: body.block ?? null,
      duration_sec: body.durationSec != null ? Math.round(body.durationSec * 100) / 100 : null,
      session_id: body.sessionId ?? null,
    });

    if (PIPELINE_AUTOSTART) {
      const url = new URL(`/api/stories/${story.id}/process`, req.url);
      const run = async () => {
        try {
          const res = await fetch(url, { method: "POST", headers: { "x-family-token": token! } });
          if (!res.ok) console.info(`[stories] конвейер не запущен (${res.status}) — история ${story.id} ждёт в uploaded`);
        } catch (e) {
          console.info("[stories] конвейер недоступен:", e instanceof Error ? e.message : e);
        }
      };
      try {
        after(run); // после ответа, не задерживая семью
      } catch {
        void run(); // вне запроса Next (тесты)
      }
    }
    return ok({ storyId: story.id, status: story.status }, 201);
  } catch (e) {
    return errorResponse(e);
  }
}
