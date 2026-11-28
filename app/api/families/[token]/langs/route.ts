// #231 (флаг lang_kk): «Языки книги» семьи — RU + KR / RU + KZ / только RU (решение Данила 27.11: одна цена).
// PATCH /api/families/:token/langs { langs: "ru,ko" | "ru,kk" | "ru" } → families.book_langs.
// Готовые главы, которым не хватает перевода на новый язык, ставятся в «translating» и переводятся в фоне
// (каждая — своим вызовом /process); не успели — доведут открытие страницы семьи (#166) и kick-stuck.
// #306 (флаг lang_change): после первой готовой (бесплатной) главы базовые языки не меняются (409 — «Добавить язык»);
// до неё смена — только с галочкой «Согласен» под новым текстом согласия ({ agree: true }), запись — book_lang_consents.
import { z } from "zod";
import { consentText } from "@/app/(family)/consent/[token]/text";
import { errorResponse, ok, readJson, requireFamily } from "@/app/api/_family/http";
import { markBookOutdated } from "@/lib/book/build";
import { AccessError } from "@/lib/db/access";
import { flag } from "@/lib/flags";
import { langsLocked } from "@/lib/payments/langs";
import { BOOK_LANG_CHOICES, effectiveBookLangs } from "@/lib/pipeline/langs";
import type { BookLang } from "@/lib/types";
import { kickTranslations, saveLangConsent, writeBookLangs } from "./change";

export const dynamic = "force-dynamic";

const Body = z.object({
  langs: z.enum(BOOK_LANG_CHOICES.map((c) => c.id) as [string, ...string[]]),
  agree: z.boolean().optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const view = await requireFamily(token);
    const { family } = view;
    const fctx = { familyId: family.id, labs: family.labs };
    if (!flag("lang_kk", fctx)) {
      return ok({ error: "forbidden", message: "Выбор языков книги пока недоступен" }, 403);
    }
    const body = Body.parse(await readJson(req));
    const choice = BOOK_LANG_CHOICES.find((c) => c.id === body.langs)!;
    const langs: BookLang[] = [...choice.langs];

    if (flag("lang_change", fctx)) {
      const before = effectiveBookLangs(family, true);
      if (before.join(",") === langs.join(",")) return ok({ langs, queued: 0 });
      if (langsLocked(view.stories)) {
        return ok(
          { error: "locked", message: "Первая глава уже готова — сменить язык книги нельзя. Можно добавить ещё один язык." },
          409,
        );
      }
      if (body.agree !== true) throw new AccessError("bad_request", "Отметьте галочку «Согласен» под текстом согласия");
      const st = view.storyteller;
      await saveLangConsent({
        family_id: family.id,
        storyteller_id: st?.id ?? null,
        reason: "change",
        from_langs: before,
        langs,
        text: consentText(st?.name ?? "рассказчик", langs),
      });
    }

    const queued = await writeBookLangs(family.id, langs);
    await markBookOutdated(family.id).catch(() => undefined);
    kickTranslations(req, token, queued);
    return ok({ langs, queued: queued.length });
  } catch (e) {
    return errorResponse(e);
  }
}
