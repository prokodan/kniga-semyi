// #306 (флаги lang_kk + lang_change): «Добавить язык» после первой готовой (бесплатной) главы.
// POST /api/families/:token/langs/add { lang: "kk" | "ko", agree: true } → демо-оплата (lib/payments, денег нет,
// demo_orders product = "lang") → язык в конец families.book_langs → согласие галочкой (book_lang_consents, reason add)
// → готовые главы встают на перевод. Повторное нажатие: язык уже есть — тот же ответ без второго заказа.
import { z } from "zod";
import { consentText } from "@/app/(family)/consent/[token]/text";
import { errorResponse, ok, readJson, requireFamily } from "@/app/api/_family/http";
import { markBookOutdated } from "@/lib/book/build";
import { AccessError } from "@/lib/db/access";
import { flag } from "@/lib/flags";
import { checkoutLangDemo } from "@/lib/payments";
import { addableLangs, langsLocked, withAddedLang } from "@/lib/payments/langs";
import { effectiveBookLangs } from "@/lib/pipeline/langs";
import { kickTranslations, saveLangConsent, saveLangOrder, writeBookLangs } from "../change";

export const dynamic = "force-dynamic";

const Body = z.object({ lang: z.enum(["kk", "ko"]), agree: z.boolean().optional() });

const inFlight = new Map<string, Promise<unknown>>();

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const view = await requireFamily(token);
    const { family } = view;
    const fctx = { familyId: family.id, labs: family.labs };
    if (!flag("lang_kk", fctx) || !flag("lang_change", fctx)) {
      return ok({ error: "forbidden", message: "Добавить язык пока нельзя" }, 403);
    }
    const { lang, agree } = Body.parse(await readJson(req));
    const before = effectiveBookLangs(family, true);
    if (before.includes(lang)) return ok({ langs: before, queued: 0, repeated: true });
    if (!addableLangs(before).includes(lang)) throw new AccessError("bad_request", "Этот язык добавить нельзя");
    if (!langsLocked(view.stories)) {
      throw new AccessError("bad_request", "Первой главы ещё нет — языки книги пока можно просто выбрать на странице книги");
    }
    if (agree !== true) throw new AccessError("bad_request", "Отметьте галочку «Согласен» под текстом согласия");

    // двойной тап — два запроса почти разом: второй ждёт первый и видит язык уже добавленным
    const key = family.id;
    const prev = inFlight.get(key);
    if (prev) {
      await prev.catch(() => undefined);
      const again = await requireFamily(token);
      const now = effectiveBookLangs(again.family, true);
      if (now.includes(lang)) return ok({ langs: now, queued: 0, repeated: true });
    }
    const run = (async () => {
      const langs = withAddedLang(before, lang);
      const pay = await checkoutLangDemo(saveLangOrder, { familyId: family.id, lang });
      const st = view.storyteller;
      await saveLangConsent({
        family_id: family.id,
        storyteller_id: st?.id ?? null,
        reason: "add",
        from_langs: before,
        langs,
        text: consentText(st?.name ?? "рассказчик", langs),
      });
      const queued = await writeBookLangs(family.id, langs);
      await markBookOutdated(family.id).catch(() => undefined);
      kickTranslations(req, token, queued);
      return { langs, queued: queued.length, orderId: pay.orderId, amountKzt: pay.amountKzt, demo: true };
    })();
    inFlight.set(key, run);
    try {
      return ok(await run, 201);
    } finally {
      if (inFlight.get(key) === run) inFlight.delete(key);
    }
  } catch (e) {
    return errorResponse(e);
  }
}
