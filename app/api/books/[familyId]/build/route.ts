import { errorResponse, familyToken, ok, readJson, requireFamily } from "@/app/api/_family/http";
import { AccessError } from "@/lib/db/access";
import { BookBusyError, buildBook, getBookView } from "@/lib/book/build";
import { requestOrigin } from "@/lib/book/chapter";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function familyFor(req: Request, familyId: string, body: Record<string, unknown> | null) {
  const token = familyToken(req, body) ?? new URL(req.url).searchParams.get("token") ?? undefined;
  const view = await requireFamily(token);
  if (view.family.id !== familyId) throw new AccessError("forbidden", "Ссылка семьи не подходит к этой книге");
  return view;
}

// POST /api/books/:familyId/build — собрать книгу (токен: x-family-token, поле token или ?token=).
// Ответ: { status: "ready" | "failed", page_count, chapters, bytes, ms, error, missing_korean }.
export async function POST(req: Request, ctx: { params: Promise<{ familyId: string }> }) {
  try {
    const { familyId } = await ctx.params;
    await familyFor(req, familyId, await readJson(req));
    const result = await buildBook(familyId, { origin: await requestOrigin() });
    return ok(result, result.status === "ready" ? 200 : 500);
  } catch (e) {
    if (e instanceof BookBusyError) return ok({ error: "busy", message: e.message }, 409);
    return errorResponse(e);
  }
}

// GET /api/books/:familyId/build — статус книги (для экрана и smoke).
export async function GET(req: Request, ctx: { params: Promise<{ familyId: string }> }) {
  try {
    const { familyId } = await ctx.params;
    await familyFor(req, familyId, null);
    return ok(await getBookView(familyId));
  } catch (e) {
    return errorResponse(e);
  }
}
