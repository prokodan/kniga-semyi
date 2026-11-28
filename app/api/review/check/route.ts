// POST /api/review/check — отзыв проверяющего /review 2.0 (#353): правка абзаца, оценки по критериям, фокус-слова
// («верно / неверно → как правильно»), комментарий, «пропустить»; { action: "complete" } — итоговый экран «Готово».
// Токен — в заголовке x-review-token (адреса API попадают в логи Vercel). В логи — только id ссылки.
// За флагом quality_loop: выключен — 404, старые ссылки пишут в POST /api/review как раньше.
import { after, NextResponse } from "next/server";
import { FeedbackError, parseCheckFeedback } from "@/app/admin/quality/checks/_lib/feedback";
import { checkStore, openCheck } from "@/app/admin/quality/checks/_lib/store";
import { digestNow } from "@/app/admin/quality/findings/_lib/store";
import { flag } from "@/lib/flags";

export const dynamic = "force-dynamic";
// #354: после «Готово» разбор этой ссылки (quality-digest) идёт в after() — до лимита функции
export const maxDuration = 60;

const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(req: Request) {
  if (!flag("quality_loop")) return json(404, { error: "not_found" });
  const token = req.headers.get("x-review-token") ?? "";
  let linkId: string | null = null;
  try {
    const opened = await openCheck(token);
    if (opened.status === "missing" || opened.status === "legacy") return json(404, { error: "not_found" });
    if (opened.status !== "active") return json(410, { error: opened.status });
    linkId = opened.link.id;
    const raw: unknown = await req.json().catch(() => null);
    const { store } = checkStore();
    if (raw && typeof raw === "object" && (raw as { action?: unknown }).action === "complete") {
      await store.complete(linkId);
      // #354: ссылка закрыта — сразу разбор её отзывов (находки, авто-предложение при ≥ 3); ответ проверяющему не ждёт
      const closed = linkId;
      const started = Date.now();
      after(async () => {
        try {
          const r = await digestNow("link", { linkId: closed, deadline: started + 55_000 });
          if (r) console.log(`[quality-digest] ссылка ${closed.slice(0, 8)}: ${r.status}, новых находок ${r.findingsNew}, слито ${r.findingsMerged}`);
        } catch (e) {
          console.error(`[quality-digest] ссылка ${closed.slice(0, 8)}:`, e instanceof Error ? e.message : e);
        }
      });
      return json(200, { ok: true, completed: true });
    }
    const input = parseCheckFeedback(raw);
    const item = opened.bundle.items.find((i) => i.id === input.item_id);
    if (!item) return json(404, { error: "item_not_found" });
    if (input.terms) {
      const n = Array.isArray(item.focus_terms) ? item.focus_terms.length : 0;
      if (Object.keys(input.terms).some((k) => Number(k) >= n)) return json(400, { error: "bad_request", message: "terms: нет такого слова" });
    }
    const saved = await store.saveFeedback(linkId, input);
    if (!saved) return json(404, { error: "item_not_found" });
    return json(200, { ok: true, savedAt: new Date().toISOString() });
  } catch (e) {
    if (e instanceof FeedbackError) return json(400, { error: "bad_request", message: e.message });
    console.error(`[review/check] ссылка ${linkId?.slice(0, 8) ?? "?"}:`, e instanceof Error ? e.message : e);
    return json(500, { error: "server_error" });
  }
}
