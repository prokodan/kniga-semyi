import { entityService } from "@/lib/entities";
import { readJson } from "@/app/api/_family/http";
import { bookOf, changeResponse, EntityBody, entityError, requireFamily, translateInBackground } from "../_lib";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// PATCH /api/families/:token/entities/:id — правка записи { name_ru?, name_ko?, name_kk? (RU + KZ), description?, kind? }.
// Новое написание заменяется во всех главах семьи; главам с новым русским текстом — новый перевод (в фоне).
export async function PATCH(req: Request, ctx: { params: Promise<{ token: string; id: string }> }) {
  try {
    const { token, id } = await ctx.params;
    const { family } = await requireFamily(token);
    const body = EntityBody.parse((await readJson(req)) ?? {});
    const { langs, opts } = bookOf(family);
    const change = await entityService().edit(family.id, id, body, opts);
    translateInBackground(req, token, change, langs);
    return changeResponse(change, 200, langs);
  } catch (e) {
    return entityError(e);
  }
}
