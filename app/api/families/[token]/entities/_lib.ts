import "server-only";
// Общее для ручек словаря имён (#104): семья по токену из пути, ошибки → HTTP, перевод затронутых глав в фоне.
import { after } from "next/server";
import { z } from "zod";
import { errorResponse, ok, requireFamily } from "@/app/api/_family/http";
import { EntityError, type EntityChange } from "@/lib/entities";

export { ok, requireFamily };

export const EntityBody = z.object({
  kind: z.enum(["person", "place", "word"]).optional(),
  name_ru: z.string().max(200).optional(),
  name_ko: z.string().max(200).nullable().optional(),
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
export function translateInBackground(req: Request, token: string, change: EntityChange) {
  if (change.retranslate.length === 0) return;
  const url = `${new URL(req.url).origin}/api/families/${encodeURIComponent(token)}/entities/translate`;
  const run = async () => {
    await Promise.all(
      change.retranslate.map((storyId) =>
        fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ storyId, koFix: change.koFix }),
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

/** Ответ после правки: запись, сколько глав поправлено и что книга теперь устарела. */
export function changeResponse(change: EntityChange, status = 200) {
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
          ? `Исправили в ${chapters} ${chapters === 1 ? "главе" : chapters < 5 ? "главах" : "главах"}${change.retranslate.length ? " — корейский перевод обновится за пару минут" : ""}. Книгу нужно пересобрать.`
          : "Сохранили",
    },
    status,
  );
}
