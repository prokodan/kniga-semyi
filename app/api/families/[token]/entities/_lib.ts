import "server-only";
// Общее для ручек словаря имён (#104): семья по токену из пути, ошибки → HTTP, перевод затронутых глав в фоне.
// #305 / #311: всё, что зависит от языков книги (сообщение, name_kk, шаг перевода), — по familyBookLangs (флаг lang_kk
// внутри). Книга RU + KR — ответы и запросы ровно как раньше.
import { after } from "next/server";
import { z } from "zod";
import { errorResponse, ok, requireFamily } from "@/app/api/_family/http";
import { EntityError, type EntityChange, type EntityOptions } from "@/lib/entities";
import { familyBookLangs } from "@/lib/pipeline/book-langs";
import { langUi } from "@/lib/pipeline/langs";
import type { BookLang } from "@/lib/types";

export { ok, requireFamily };

/** Языки книги семьи из requireFamily и что из них следует для словаря. */
export function bookOf(family: Parameters<typeof familyBookLangs>[0]): { langs: BookLang[]; opts: EntityOptions } {
  const langs = familyBookLangs(family);
  return { langs, opts: langs.includes("kk") ? { kk: true } : {} };
}

export const EntityBody = z.object({
  kind: z.enum(["person", "place", "word"]).optional(),
  name_ru: z.string().max(200).optional(),
  name_ko: z.string().max(200).nullable().optional(),
  /** #311: казахское написание — читается только у книги RU + KZ */
  name_kk: z.string().max(200).nullable().optional(),
  description: z.string().max(400).nullable().optional(),
});

const STATUS: Record<EntityError["code"], number> = { bad_request: 400, not_found: 404, conflict: 409 };

export function entityError(e: unknown) {
  if (e instanceof EntityError) return ok({ error: e.code, message: e.message }, STATUS[e.code]);
  return errorResponse(e);
}

/**
 * Каждой главе с новым русским текстом — свой вызов перевода (своя функция и свои 60 с), как цепочка
 * конвейера (lib/pipeline/chain.ts). Ответа не ждём; не дошло — перевод доведут экран главы или kick-stuck.
 */
export function translateInBackground(req: Request, token: string, change: EntityChange, langs: readonly BookLang[]) {
  if (change.retranslate.length === 0) return;
  const url = `${new URL(req.url).origin}/api/families/${encodeURIComponent(token)}/entities/translate`;
  // #305: без корейского — следующий шаг по данным (kk или сразу ready у «только RU»); RU + KR — тело как раньше
  const any = !langs.includes("ko");
  const run = async () => {
    await Promise.all(
      change.retranslate.map((storyId) =>
        fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(any ? { storyId, koFix: change.koFix, any } : { storyId, koFix: change.koFix }),
          signal: AbortSignal.timeout(2_500),
        }).catch(() => undefined),
      ),
    );
  };
  try {
    after(run);
  } catch {
    // вне запроса Next (тесты) — фона нет
  }
}

/** «— корейский перевод обновится за пару минут» по второму языку книги; книга только RU — без хвоста (#305). */
export function translateTail(langs: readonly BookLang[]): string {
  const ui = langUi(langs);
  return ui ? ` — ${ui.name} перевод обновится за пару минут` : "";
}

/** Ответ после правки: запись, сколько глав поправлено и что книга теперь устарела. */
export function changeResponse(change: EntityChange, status = 200, langs: readonly BookLang[] = ["ru", "ko"]) {
  const chapters = change.retranslate.length + change.koOnly.length;
  return ok(
    {
      entity: change.entity,
      retranslate: change.retranslate,
      koOnly: change.koOnly,
      chapters,
      bookOutdated: chapters > 0,
      message:
        chapters > 0
          ? `Исправили в ${chapters} ${chapters === 1 ? "главе" : chapters < 5 ? "главах" : "главах"}${change.retranslate.length ? translateTail(langs) : ""}. Книгу нужно пересобрать.`
          : "Сохранили",
    },
    status,
  );
}
