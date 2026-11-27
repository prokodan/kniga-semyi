// POST /api/review — отзыв носителя (#232): правка абзаца, оценки, комментарий, «пропустить».
// Токен ссылки — в заголовке x-review-token (не в адресе: адреса API попадают в логи Vercel). В логи — только id ссылки.
import { NextResponse } from "next/server";
import { FeedbackError, parseFeedback } from "@/app/admin/reviews/_lib/core";
import { openReview, reviewStore } from "@/app/admin/reviews/_lib/store";

export const dynamic = "force-dynamic";

const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(req: Request) {
  const token = req.headers.get("x-review-token") ?? "";
  let linkId: string | null = null;
  try {
    const opened = await openReview(token);
    if (opened.status === "missing") return json(404, { error: "not_found" });
    if (opened.status !== "active") return json(410, { error: opened.status });
    linkId = opened.link.id;
    const raw: unknown = await req.json().catch(() => null);
    const input = parseFeedback(raw);
    const saved = await reviewStore().store.saveFeedback(linkId, input);
    if (!saved) return json(404, { error: "item_not_found" });
    return json(200, { ok: true, savedAt: new Date().toISOString() });
  } catch (e) {
    if (e instanceof FeedbackError) return json(400, { error: "bad_request", message: e.message });
    console.error(`[review] ссылка ${linkId?.slice(0, 8) ?? "?"}:`, e instanceof Error ? e.message : e);
    return json(500, { error: "server_error" });
  }
}
