import { chapterText, loadStoryTexts } from "@/lib/book/texts";
import { getDbOrNull } from "@/lib/db";
import { getFamilyByToken } from "@/lib/db/access";
import { familyBookLangs } from "@/lib/pipeline/book-langs";
import { statusMessage } from "@/lib/pipeline/engine";
import { familyToken, ok } from "@/lib/interview/http";
import { pipeline } from "@/lib/pipeline";
import { pipelineError } from "@/lib/pipeline/http";
import type { BookLang } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/stories/:id — статус и результат истории для экрана ожидания (токен: x-family-token или ?token=).
// #293 / #245: книга не RU + KR → сообщение перевода по языкам книги, `book_langs`, у RU + KZ ещё `kk` (текст из
// story_texts). Книга RU + KR — ответ как раньше, без новых полей. Языки читаем только на шаге перевода и у готовой главы.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const token = familyToken(req, null) ?? new URL(req.url).searchParams.get("token") ?? undefined;
    if (!token) return ok({ error: "forbidden", message: "Нужна ссылка семьи" }, 403);
    const view = await pipeline.view(id, { token });
    if (view.status !== "translating" && !view.done) return ok(view);
    const langs = await bookLangsFor(token);
    if (!langs || langs.join(",") === "ru,ko") return ok(view);
    return ok({ ...view, message: statusMessage(view.status, langs), book_langs: langs, ...(langs.includes("kk") && view.done ? { kk: await kkText(view.storyId) } : {}) });
  } catch (e) {
    return pipelineError(e);
  }
}

/** Языки книги семьи; сбой — null (ответ как раньше). */
async function bookLangsFor(token: string): Promise<BookLang[] | null> {
  try {
    const fam = await getFamilyByToken(token);
    return fam ? familyBookLangs(fam.family) : null;
  } catch {
    return null;
  }
}

/** Казахский текст главы (story_texts); нет — null. */
async function kkText(storyId: string) {
  const db = getDbOrNull();
  if (!db) return null;
  const rows = await loadStoryTexts(db, [storyId]);
  const kk = chapterText({ id: storyId, text_ru: null, title: null, quote: null, text_ko: null, title_ko: null, quote_ko: null }, rows, "kk");
  return kk.text ? kk : null;
}
