// #231 (флаг lang_kk): «Языки книги» семьи — RU + KR / RU + KZ / только RU (решение Данила 27.11: одна цена).
// PATCH /api/families/:token/langs { langs: "ru,ko" | "ru,kk" | "ru" } → families.book_langs.
// Готовые главы, которым не хватает перевода на новый язык, ставятся в «translating» и переводятся в фоне
// (каждая — своим вызовом /process); не успели — доведут открытие страницы семьи (#166) и kick-stuck.
import { z } from "zod";
import { errorResponse, ok, readJson, requireFamily } from "@/app/api/_family/http";
import { markBookOutdated } from "@/lib/book/build";
import { loadStoryTexts } from "@/lib/book/texts";
import { getDbOrNull } from "@/lib/db";
import { getFamilyStore, MemoryFamilyStore } from "@/lib/db/access";
import { flag } from "@/lib/flags";
import { continueInBackground } from "@/lib/pipeline/chain";
import { BOOK_LANG_CHOICES, effectiveBookLangs, pendingTranslations } from "@/lib/pipeline/langs";
import type { MemoryPipelineRepo } from "@/lib/pipeline/repo";
import type { BookLang, Story } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Сразу запускаем перевод стольких глав; остальные — при открытии страницы семьи / kick-stuck. */
const KICK_NOW = 8;

const Body = z.object({ langs: z.enum(BOOK_LANG_CHOICES.map((c) => c.id) as [string, ...string[]]) });

export async function PATCH(req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const { family } = await requireFamily(token);
    if (!flag("lang_kk", { familyId: family.id, labs: family.labs })) {
      return ok({ error: "forbidden", message: "Выбор языков книги пока недоступен" }, 403);
    }
    const choice = BOOK_LANG_CHOICES.find((c) => c.id === Body.parse(await readJson(req)).langs)!;
    const langs: BookLang[] = [...choice.langs];

    const db = getDbOrNull();
    let queued: string[] = [];
    if (db) {
      const { error } = await db.from("families").update({ book_langs: langs }).eq("id", family.id);
      if (error) throw new Error(`языки книги: ${error.message}`);
      const { data, error: e2 } = await db
        .from("stories")
        .select("id, text_ko, text_ru")
        .eq("family_id", family.id)
        .eq("status", "ready")
        .is("parent_story_id", null);
      if (e2) throw new Error(`главы семьи: ${e2.message}`);
      const stories = (data ?? []) as Pick<Story, "id" | "text_ko" | "text_ru">[];
      const rows = await loadStoryTexts(db, stories.map((s) => s.id));
      const target = effectiveBookLangs({ book_langs: langs }, true);
      queued = stories
        .filter((s) => s.text_ru && pendingTranslations(target, s, rows.filter((r) => r.story_id === s.id && r.text != null).map((r) => r.lang)).length > 0)
        .map((s) => s.id);
      if (queued.length) {
        const { error: e3 } = await db.from("stories").update({ status: "translating", error: null }).in("id", queued).eq("status", "ready");
        if (e3) throw new Error(`перевод глав: ${e3.message}`);
      }
    } else {
      // без Supabase (локально, mock): семья в памяти и план конвейера в памяти
      const store = getFamilyStore();
      if (store instanceof MemoryFamilyStore) {
        const f = store.families.get(family.id);
        if (f) f.book_langs = langs;
      }
      (globalThis as { __pipelineMemoryRepo?: MemoryPipelineRepo }).__pipelineMemoryRepo?.bookLangs.set(family.id, langs);
    }
    await markBookOutdated(family.id).catch(() => undefined);
    for (const id of queued.slice(0, KICK_NOW)) continueInBackground(req, id, token);
    return ok({ langs, queued: queued.length });
  } catch (e) {
    return errorResponse(e);
  }
}
