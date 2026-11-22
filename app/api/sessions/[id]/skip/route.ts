import { z } from "zod";
import { interview } from "@/lib/interview";
import { errorResponse, familyToken, ok, readJson } from "@/lib/interview/http";
import { releaseAfterInterview } from "@/lib/pipeline/chain";

export const dynamic = "force-dynamic";

const Body = z.object({ action: z.enum(["skip", "later"]).default("skip") });

// POST /api/sessions/:id/skip — { action: "skip" } пропустить вопрос / { action: "later" } вернуться позже.
// Без уточнений. Ответ — как у /answer: nextQuestion | blockDone | finished.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const raw = await readJson(req);
    const token = familyToken(req, raw);
    if (!token) return ok({ error: "forbidden", message: "Нужна ссылка семьи" }, 403);
    const { action } = Body.parse(raw ?? {});
    const res = await interview.skip(id, action, { token });
    releaseAfterInterview(req, res, token); // вопрос закрыт — собрать главу с тем, что есть
    return ok(res);
  } catch (e) {
    return errorResponse(e);
  }
}
