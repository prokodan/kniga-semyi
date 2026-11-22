import { z } from "zod";
import { errorResponse, familyToken, ok, readJson, requireFamily } from "@/app/api/_family/http";
import { getTaleView, illustratePage, TaleError, writeTale } from "@/lib/tale";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATUS: Record<TaleError["code"], number> = { not_enough: 409, busy: 409, not_ready: 409, bad_page: 400, unavailable: 503 };

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("write"), childName: z.string().max(80).optional(), again: z.boolean().default(false) }),
  z.object({
    action: z.literal("illustrate"),
    page: z.number().int().min(0).max(9),
    regenerate: z.boolean().default(false),
    fallback: z.boolean().default(false),
  }),
]);

// POST /api/extras/tale — по ссылке семьи (x-family-token или поле token):
//   { action: "write", childName?, again? }      → текст сказки (ai.run("tale")), ответ — TaleView
//   { action: "illustrate", page, regenerate?, fallback? } → картинка страницы (ai.run("illustrate")),
//     ответ — { page, image, fallback, notice }; художник недоступен → картинка из готового набора, не ошибка;
//     fallback: true — сразу из набора (браузер не дождался ответа: функция упала по лимиту времени)
// Картинки страница просит параллельно, по запросу на страницу: каждый укладывается в лимит функции.
export async function POST(req: Request) {
  try {
    const raw = await readJson(req);
    const view = await requireFamily(familyToken(req, raw));
    const body = Body.parse({ action: "write", ...(raw ?? {}) });
    if (body.action === "write") {
      return ok(await writeTale(view.family.id, { childName: body.childName, again: body.again }));
    }
    return ok(await illustratePage(view.family.id, body.page, { regenerate: body.regenerate, fallback: body.fallback }));
  } catch (e) {
    if (e instanceof TaleError) return ok({ error: e.code, message: e.message }, STATUS[e.code]);
    return errorResponse(e);
  }
}

// GET /api/extras/tale?token=… — статус сказки: текст, готовые картинки, сколько глав у семьи.
export async function GET(req: Request) {
  try {
    const token = familyToken(req, null) ?? new URL(req.url).searchParams.get("token") ?? undefined;
    const view = await requireFamily(token);
    return ok(await getTaleView(view.family.id));
  } catch (e) {
    return errorResponse(e);
  }
}
