import { z } from "zod";
import { entityService } from "@/lib/entities";
import { readJson } from "@/app/api/_family/http";
import { bookOf, changeResponse, entityError, requireFamily, translateInBackground } from "../../_lib";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ into: z.string().min(1) });

// POST /api/families/:token/entities/:id/merge { into } — «это один человек»: запись :id убираем,
// её написание во всех главах меняем на написание записи into.
export async function POST(req: Request, ctx: { params: Promise<{ token: string; id: string }> }) {
  try {
    const { token, id } = await ctx.params;
    const { family } = await requireFamily(token);
    const { into } = Body.parse((await readJson(req)) ?? {});
    const { langs, opts } = bookOf(family);
    const change = await entityService().merge(family.id, id, into, opts);
    translateInBackground(req, token, change, langs);
    return changeResponse(change, 200, langs);
  } catch (e) {
    return entityError(e);
  }
}
