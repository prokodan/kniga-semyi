import { errorResponse, ok, requireFamily } from "@/app/api/_family/http";
import { AccessError } from "@/lib/db/access";
import { bookPdf, demoBookPdf } from "@/lib/book/build";
import { requestOrigin } from "@/lib/book/chapter";

export const dynamic = "force-dynamic";

// GET /api/books/:familyId/pdf?token=<токен семьи>[&download=1] — последний PDF книги.
// Прод: редирект на подписанную ссылку Storage (час). Локально (без Supabase): PDF из памяти.
// Постоянная ссылка для кнопки «Скачать»: подписанные ссылки Storage живут час, эта — всегда.
// /api/books/demo/pdf — демо-книга без токена (7 глав Ким Чер Су, без персональных данных): проверка с телефона
// и запасной слайд питча. QR в демо ведут на /start.
export async function GET(req: Request, ctx: { params: Promise<{ familyId: string }> }) {
  try {
    const { familyId } = await ctx.params;
    const url = new URL(req.url);
    if (familyId === "demo") {
      return new Response(new Uint8Array(await demoBookPdf(await requestOrigin())), {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": 'inline; filename="kniga-semyi-demo.pdf"',
          "cache-control": "public, max-age=300",
          "x-robots-tag": "noindex",
        },
      });
    }
    const view = await requireFamily(url.searchParams.get("token") ?? req.headers.get("x-family-token") ?? undefined);
    if (view.family.id !== familyId) throw new AccessError("forbidden", "Ссылка семьи не подходит к этой книге");
    const download = url.searchParams.get("download") === "1";
    const file = await bookPdf(familyId, { download });
    if (!file) return ok({ error: "not_found", message: "Книга ещё не собрана" }, 404);
    if ("url" in file) return Response.redirect(file.url, 302);
    return new Response(new Uint8Array(file.pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `${download ? "attachment" : "inline"}; filename="kniga-semyi.pdf"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
