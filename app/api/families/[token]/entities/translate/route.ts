import { z } from "zod";
import { entityService, EntityError, retranslateChapter } from "@/lib/entities";
import { readJson } from "@/app/api/_family/http";
import { PipelineError } from "@/lib/pipeline";
import { pipelineError } from "@/lib/pipeline/http";
import { entityError, ok, requireFamily } from "../_lib";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  storyId: z.string().min(1),
  koFix: z.object({ from: z.string().min(1), to: z.string().min(1) }).nullable().optional(),
  /** #305: книга без корейского — следующий шаг по данным (см. retranslateChapter) */
  any: z.boolean().optional(),
});

// POST /api/families/:token/entities/translate { storyId, koFix? } — новый перевод одной главы после правки
// словаря (вызывает сама правка в фоне). Глава должна быть из этой семьи.
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const { family } = await requireFamily(token);
    const { storyId, koFix, any } = Body.parse((await readJson(req)) ?? {});
    const chapters = await entityService().chapters(family.id);
    if (!chapters.some((c) => c.id === storyId)) throw new EntityError("not_found", "Глава не найдена");
    const res = await retranslateChapter(family.id, storyId, koFix ?? null, any ? { any } : {});
    return ok(res, res.queued ? 202 : 200);
  } catch (e) {
    if (e instanceof PipelineError) return pipelineError(e); // перевод уже сделан / глава ещё собирается
    return entityError(e);
  }
}
