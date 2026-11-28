import { entityService } from "@/lib/entities";
import { readJson } from "@/app/api/_family/http";
import { bookOf, changeResponse, EntityBody, entityError, ok, requireFamily } from "./_lib";

export const dynamic = "force-dynamic";

// GET /api/families/:token/entities — словарь имён семьи (#104): записи и главы (id, заголовок) для ссылок.
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const { family } = await requireFamily(token);
    const svc = entityService();
    const [entities, chapters] = await Promise.all([svc.list(family.id), svc.chapters(family.id)]);
    return ok({ entities, chapters: chapters.map((c) => ({ id: c.id, title: c.title, status: c.status })) });
  } catch (e) {
    return entityError(e);
  }
}

// POST /api/families/:token/entities — добавить запись вручную { kind, name_ru, name_ko?, name_kk? (RU + KZ), description? }.
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const { family } = await requireFamily(token);
    const body = EntityBody.parse((await readJson(req)) ?? {});
    const { langs, opts } = bookOf(family);
    return changeResponse(await entityService().add(family.id, body, opts), 201, langs);
  } catch (e) {
    return entityError(e);
  }
}
