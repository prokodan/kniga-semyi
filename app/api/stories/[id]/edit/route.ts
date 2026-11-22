import { familyToken, ok, readJson } from "@/lib/interview/http";
import { pipelineError } from "@/lib/pipeline/http";
import { DraftSchema } from "@/components/draft/draft";
import { DraftError, saveDraft } from "@/components/draft/save";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// PATCH /api/stories/:id/edit — семья правит заголовок, цитату и текст RU (токен: x-family-token или поле token).
// Сохраняем → перезапускаем только перевод (runStep(id, "translate")). Если ИИ занят — queued: true,
// экран главы сам доведёт перевод. Ответ: DraftSaveResult (components/draft/draft.ts).
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const raw = await readJson(req);
    const token = familyToken(req, raw);
    if (!token) return ok({ error: "forbidden", message: "Нужна ссылка семьи" }, 403);
    const fields = DraftSchema.parse({ title: raw?.title ?? "", quote: raw?.quote ?? "", text_ru: raw?.text_ru ?? "" });
    const res = await saveDraft(id, token, fields);
    return ok(res, res.queued ? 202 : 200);
  } catch (e) {
    if (e instanceof DraftError) return ok({ error: "conflict", message: e.message }, 409);
    return pipelineError(e);
  }
}
