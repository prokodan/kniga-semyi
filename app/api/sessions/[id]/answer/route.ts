import { z } from "zod";
import { interview } from "@/lib/interview";
import { errorResponse, familyToken, ok, readJson } from "@/lib/interview/http";
import { releaseAfterInterview } from "@/lib/pipeline/chain";

export const dynamic = "force-dynamic";

const Body = z.union([
  z.object({ text: z.string().trim().min(1).max(20_000) }),
  z.object({ storyId: z.string().min(1) }),
]);

// POST /api/sessions/:id/answer — ответ текстом { text } или готовой историей { storyId }
// (берётся stories.transcript после шага transcribe I2; пока не готов — 409 not_ready).
// Ответ: { type: "followup" | "nextQuestion" | "blockDone" | "finished", … } — см. AnswerResult в lib/interview/engine.ts.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const raw = await readJson(req);
    const token = familyToken(req, raw);
    if (!token) return ok({ error: "forbidden", message: "Нужна ссылка семьи" }, 403);
    const body = Body.parse(raw ?? {});
    const input = "text" in body ? { text: body.text } : { storyId: body.storyId };
    const res = await interview.submitAnswer(id, input, { token });
    releaseAfterInterview(req, res, token); // вопрос закрыт — собрать главу с уточнениями
    return ok(res);
  } catch (e) {
    return errorResponse(e);
  }
}
