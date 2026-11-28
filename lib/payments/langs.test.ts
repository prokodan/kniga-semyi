// #306 смена языков книги, #301 точка входа /start — чистые правила. RU + KR не меняется (снимки текстов до PR).
import { describe, expect, it } from "vitest";
import { consentText } from "@/app/(family)/consent/[token]/text";
import { AKNC_START_LINK, defaultsFor, startDefaultPacks } from "@/lib/interview/start-choices";
import { effectiveBookLangs, extraBookLangs } from "@/lib/pipeline/langs";
import { checkoutLangDemo, LANG_EXTRA_KZT, langExtraKey, quoteKzt } from "./index";
import { addableLangs, addLangOffers, baseChoiceOf, LANG_LOCK_WARNING, langsLocked, withAddedLang } from "./langs";

const KR_CONSENT =
  "Я, Анна, согласен (согласна), чтобы мои рассказы записывали для книги нашей семьи. " +
  "Я знаю, что запись голоса обрабатывают внешние сервисы искусственного интеллекта — они переводят речь в текст " +
  "и помогают с переводом на корейский. Записи и книгу видит только наша семья.";

describe("#306 блокировка после первой готовой главы", () => {
  it("готовая основная глава закрывает смену; уточнение и «готовится» — нет", () => {
    expect(langsLocked([])).toBe(false);
    expect(langsLocked([{ status: "editing" }, { status: "translating", parent_story_id: null }])).toBe(false);
    expect(langsLocked([{ status: "ready", parent_story_id: "x" }])).toBe(false);
    expect(langsLocked([{ status: "ready", parent_story_id: null }])).toBe(true);
  });
  it("предупреждение — формулировка Данила", () => {
    expect(LANG_LOCK_WARNING).toBe("После бесплатной главы сменить язык книги нельзя — можно только докупить ещё один язык.");
  });
});

describe("#306 «Добавить язык»", () => {
  it("что можно докупить и как меняются языки", () => {
    expect(addableLangs(["ru", "ko"])).toEqual(["kk"]);
    expect(addableLangs(["ru", "kk"])).toEqual(["ko"]);
    expect(addableLangs(["ru"])).toEqual(["kk", "ko"]);
    expect(addableLangs(["ru", "ko", "kk"])).toEqual([]);
    expect(withAddedLang(["ru", "ko"], "kk")).toEqual(["ru", "ko", "kk"]);
    expect(withAddedLang(["ru", "ko", "kk"], "kk")).toEqual(["ru", "ko", "kk"]);
    expect(addLangOffers(["ru", "ko"])).toEqual([{ lang: "kk", label: "Добавить казахский", priceKzt: 4_900 }]);
  });
  it("базовый выбор — по первым двум языкам", () => {
    expect(baseChoiceOf(["ru", "ko"])).toBe("ru,ko");
    expect(baseChoiceOf(["ru", "ko", "kk"])).toBe("ru,ko");
    expect(baseChoiceOf(["ru"])).toBe("ru");
  });
  it("докупленный язык — третьим, только с lang_kk; пары — как было", () => {
    expect(effectiveBookLangs({ book_langs: ["ru", "ko", "kk"] }, true)).toEqual(["ru", "ko", "kk"]);
    expect(effectiveBookLangs({ book_langs: ["ru", "kk", "ko"] }, true)).toEqual(["ru", "kk", "ko"]);
    expect(effectiveBookLangs({ book_langs: ["ru", "ko", "kk"] }, false)).toEqual(["ru", "ko"]);
    expect(effectiveBookLangs({ book_langs: ["ru", "ko"] }, true)).toEqual(["ru", "ko"]);
    expect(effectiveBookLangs({ book_langs: ["ru", "kk"] }, true)).toEqual(["ru", "kk"]);
    expect(effectiveBookLangs(null, true)).toEqual(["ru", "ko"]);
    expect(extraBookLangs({ book_langs: ["ru", "ko", "kk", "kk"] })).toEqual(["kk"]);
    expect(extraBookLangs({ book_langs: ["ru"] })).toEqual([]);
  });
  it("демо-оплата: product lang, 4 900 ₸, цены книги не меняются", async () => {
    const rows: unknown[] = [];
    const res = await checkoutLangDemo(async (row) => (rows.push(row), "id-1"), { familyId: "f", lang: "kk" });
    expect(res).toEqual({ orderId: "id-1", status: "paid_demo", amountKzt: LANG_EXTRA_KZT, redirectUrl: null });
    expect(rows[0]).toMatchObject({ family_id: "f", product: "lang", amount_kzt: 4_900, extras: [langExtraKey("kk")], provider: "demo" });
    expect(quoteKzt({ product: "digital", extras: [] })).toBe(6_900);
  });
});

describe("#306 текст согласия по языкам", () => {
  it("RU + KR — байт в байт как было; три языка — оба перевода", () => {
    expect(consentText("Анна", ["ru", "ko"])).toBe(KR_CONSENT);
    expect(consentText("Анна", ["ru", "ko", "kk"])).toContain("помогают с переводом на корейский и казахский.");
    expect(consentText("Анна", ["ru", "kk", "ko"])).toContain("помогают с переводом на казахский и корейский.");
  });
});

describe("#301 /start: умолчание по точке входа", () => {
  it("ссылка АКНЦ — корё-сарам (как сейчас), общая ссылка — ничего", () => {
    expect(AKNC_START_LINK).toBe("/start?pack=koryo");
    expect(startDefaultPacks("koryo")).toEqual(["koryo"]);
    expect(startDefaultPacks(undefined)).toEqual([]);
    expect(startDefaultPacks("general")).toEqual([]);
    expect(startDefaultPacks("нет-такого")).toEqual([]);
    expect(startDefaultPacks("__proto__")).toEqual([]);
    expect(defaultsFor(["general"], true)).toEqual({ spoken: "ru", book: "ru" }); // пустой выбор — общий костяк, книга RU
    expect(defaultsFor(["general", "koryo"], true)).toEqual({ spoken: "ru,koryo", book: "ru,ko" });
  });
});
