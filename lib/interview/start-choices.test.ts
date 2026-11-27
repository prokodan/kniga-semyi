// #233: стартовая анкета — варианты и разбор ответа формы.
import { describe, expect, it } from "vitest";
import { bookChoices, defaultsFor, packChoices, parseStartChoices, spokenChoices, StartChoiceError } from "./start-choices";

describe("анкета /start (#233)", () => {
  it("варианты «Кто ваша семья?» — все слои реестра по порядку", () => {
    expect(packChoices().map((c) => c.id)).toEqual(["koryo", "kz", "ua"]);
  });

  it("язык рассказа: корё мар — только с корё-сарам, казахский — только с казахской", () => {
    expect(spokenChoices(["general"]).map((c) => c.id)).toEqual(["ru"]);
    expect(spokenChoices(["general", "koryo"]).map((c) => c.id)).toEqual(["ru,koryo", "ru"]);
    expect(spokenChoices(["general", "kz", "koryo"], true).map((c) => c.id)).toEqual(["ru,koryo", "ru", "ru,kk", "kk"]);
  });

  it("#300: «По-казахски» — только с флагом spoken_kk; «По-русски, с казахскими словами» — всегда с казахской", () => {
    expect(spokenChoices(["general", "kz"]).map((c) => c.id)).toEqual(["ru", "ru,kk"]);
    expect(spokenChoices(["general", "kz"], false).map((c) => c.id)).toEqual(["ru", "ru,kk"]);
    expect(spokenChoices(["general", "kz"], true).map((c) => c.id)).toEqual(["ru", "ru,kk", "kk"]);
    expect(() => parseStartChoices({ packs: ["kz"], spoken: "kk", book: "ru" }, true)).toThrow(/языке/);
    expect(parseStartChoices({ packs: ["kz"], spoken: "kk", book: "ru" }, true, true).spoken_langs).toEqual(["kk"]);
    expect(parseStartChoices({ packs: ["kz"], spoken: "ru,kk", book: "ru" }, true).spoken_langs).toEqual(["ru", "kk"]);
  });

  it("книга RU + KZ — только с флагом lang_kk", () => {
    expect(bookChoices(true).map((c) => c.id)).toEqual(["ru,ko", "ru,kk", "ru"]);
    expect(bookChoices(false).map((c) => c.id)).toEqual(["ru,ko", "ru"]);
  });

  it("умолчания: корё-сарам — как сегодня; казахская — RU + KZ (если можно); общий — только RU", () => {
    expect(defaultsFor(["general", "koryo", "kz"], true)).toEqual({ spoken: "ru,koryo", book: "ru,ko" });
    expect(defaultsFor(["general", "kz"], true)).toEqual({ spoken: "ru", book: "ru,kk" });
    expect(defaultsFor(["general", "kz"], false)).toEqual({ spoken: "ru", book: "ru" });
    expect(defaultsFor(["general"], true)).toEqual({ spoken: "ru", book: "ru" });
  });

  it("форма по умолчанию (корё-сарам) = умолчания базы — сегодняшний продукт", () => {
    expect(parseStartChoices({ packs: ["koryo"], spoken: "ru,koryo", book: "ru,ko" }, true)).toEqual({
      culture_packs: ["general", "koryo"],
      spoken_langs: ["ru", "koryo"],
      book_langs: ["ru", "ko"],
    });
  });

  it("несколько слоёв в порядке выбора, «просто общие» = general, пусто = general", () => {
    expect(parseStartChoices({ packs: ["kz", "ua"], spoken: "ru,kk", book: "ru,kk" }, true)).toEqual({
      culture_packs: ["general", "kz", "ua"],
      spoken_langs: ["ru", "kk"],
      book_langs: ["ru", "kk"],
    });
    expect(parseStartChoices({ packs: ["general"], spoken: "ru", book: "ru" }, true).culture_packs).toEqual(["general"]);
    expect(parseStartChoices({ packs: [] }, true)).toMatchObject({ culture_packs: ["general"], book_langs: ["ru"] });
  });

  it("чужие значения и RU + KZ без флага — ошибка с понятным текстом", () => {
    expect(() => parseStartChoices({ packs: ["xx"] }, true)).toThrow(StartChoiceError);
    expect(() => parseStartChoices({ packs: ["kz"], spoken: "en" }, true)).toThrow(/языке/);
    expect(() => parseStartChoices({ packs: ["kz"], spoken: "ru", book: "ru,kk" }, false)).toThrow(/языках/);
  });
});
