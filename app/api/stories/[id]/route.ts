import { familyToken, ok } from "@/lib/interview/http";
import { pipeline } from "@/lib/pipeline";
import { pipelineError } from "@/lib/pipeline/http";

export const dynamic = "force-dynamic";

// GET /api/stories/:id — статус и результат истории для экрана ожидания (токен: x-family-token или ?token=).
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const token = familyToken(req, null) ?? new URL(req.url).searchParams.get("token") ?? undefined;
    if (!token) return ok({ error: "forbidden", message: "Нужна ссылка семьи" }, 403);
    return ok(await pipeline.view(id, { token }));
  } catch (e) {
    return pipelineError(e);
  }
}
