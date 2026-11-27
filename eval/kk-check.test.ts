import { describe, expect, it } from "vitest";
import { createRouter } from "@/lib/ai/router";
import { MemoryStore } from "@/lib/ai/store";
import translateKk from "@/fixtures/ai/translate.kk.json";
import editFixture from "@/fixtures/ai/edit.json";
import { backTranslateKk, checkKk, kkFlagRows, kkTotals, type KkItem } from "./kk-check";
import { parseBookLangs } from "./sim/persona";

const good: KkItem = {
  id: "ch1",
  label: "Кукси у печки",
  text_ru: editFixture.text_ru,
  text_kk: translateKk.text,
  title_kk: translateKk.title,
  quote_kk: translateKk.quote,
  names: ["Уштобе"],
};
const rules = (i: Partial<KkItem>) => checkKk({ ...good, ...i }).map((f) => f.rule);

describe("kk-check (#231): правила без ИИ", () => {
  it("хороший перевод (фикстура заглушки) — без флажков", () => {
    expect(checkKk(good)).toEqual([]);
  });

  it("нет казахских букв / много русских слов → 🔴", () => {
    const f = checkKk({ ...good, text_kk: "Я родился в 1940 году в Уштобе. Отец работал в колхозе, и мы сажали рис, когда было тепло." });
    expect(f.map((x) => x.rule)).toEqual(expect.arrayContaining(["letters", "russian"]));
    expect(kkTotals(f).major).toBeGreaterThanOrEqual(2);
  });

  it("одно русское слово, вариант «не:» из глоссария, «сен» → 🟡", () => {
    expect(rules({ text_kk: `${translateKk.text} Мама келді.` })).toEqual(expect.arrayContaining(["russian", "glossary:variant"]));
    expect(rules({ text_kk: `${translateKk.text} Біз аулда тұрдық.` })).toContain("glossary:variant");
    expect(rules({ text_kk: `${translateKk.text} Сен білесің бе?` })).toContain("style:sen");
    // казахские «не», «он», «мен» — не русские слова
    expect(rules({ text_kk: `${translateKk.text} Не істейміз? Он бала мен әжем.` })).not.toContain("russian");
  });

  it("годы: цифрами как в оригинале; лишний год — 🔴", () => {
    expect(rules({ text_kk: translateKk.text.replace("1940", "қырқыншы") })).toContain("years");
    expect(rules({ text_kk: `${translateKk.text} 1950 жылы.` })).toContain("years");
  });

  it("имя пропало, хангыль, цитата не из текста", () => {
    expect(rules({ text_kk: translateKk.text.replace("Үштөбеде", "ауылда") })).toContain("names");
    expect(rules({ text_kk: `${translateKk.text} 우슈토베` })).toContain("hangul");
    expect(rules({ quote_kk: "Басқа сөз." })).toContain("quote");
  });

  it("#298: латиница и из двух букв («da»), к внукам «сендер» и «сіздер» в одном абзаце — флажки", () => {
    expect(rules({ text_kk: `${translateKk.text} Машинада da емес.` })).toContain("latin");
    expect(rules({ text_kk: `${translateKk.text}\nБалаларым, бірге болыңдар, бір-біріңізге қамқор болыңыздар.` })).toContain("style:grandkids");
    expect(rules({ text_kk: `${translateKk.text}\nБалаларым, бірге болыңдар, бір-біріңе қамқор болыңдар.` })).not.toContain("style:grandkids");
  });

  it("обратный перевод kk → ru (mock): год на месте — без флажков; модель и текст записаны", async () => {
    const ai = createRouter({ store: new MemoryStore(), mode: () => "mock" });
    const r = await backTranslateKk(ai, [{ ...good, text_ru: "Я родилась в 1931 году." }]);
    expect(r.back[0]).toMatchObject({ id: "ch1", provider: "mock" });
    expect(r.flags).toEqual([]);
    const lost = await backTranslateKk(ai, [{ ...good, text_ru: "Я родилась в 1929 году." }]);
    expect(lost.flags.map((f) => f.rule)).toEqual(["back:years"]);
  });

  it("таблица флажков: сначала 🔴, лимит", () => {
    const rows = kkFlagRows(checkKk({ ...good, text_kk: "Мама и папа были в школе." }).map((flag) => ({ persona: "serik", flag })), 1);
    expect(rows[2]).toMatch(/🔴/);
    expect(rows.at(-1)).toMatch(/ещё/);
    expect(kkFlagRows([])[0]).toMatch(/не оценка носителя/);
  });
});

describe("eval-персонажи: языки книги из строки «книга:»", () => {
  it("kk,ru; «ru или ru,kk» → ru,kk; ru; нет строки — undefined", () => {
    expect(parseBookLangs("- Язык рассказа: `kk` · книга: `kk,ru` · пакеты: `general`")).toEqual(["kk", "ru"]);
    expect(parseBookLangs("· книга: `ru` или `ru,kk` · пакеты")).toEqual(["ru", "kk"]);
    expect(parseBookLangs("· книга: `ru` · пакеты")).toEqual(["ru"]);
    expect(parseBookLangs("# Ким")).toBeUndefined();
  });
});
