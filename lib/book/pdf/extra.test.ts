// #340 (флаг lang_change): докупленный третий язык книги — отдельной частью в конце PDF.
import { describe, expect, it } from "vitest";
import { DEMO_BOOK } from "./demo";
import { composeBook } from "./model";
import { countPages, renderBook } from "./render";

const voiceUrl = (id: string) => `https://kniga.example/listen/${id}?s=AAAAAAAAAAAAAAAAAAAAAA`;
const builtAt = new Date("2026-11-27T00:00:00Z");
const kk = DEMO_BOOK.stories.map((st) => ({
  story_id: st.id,
  lang: "kk" as const,
  title: `Әңгіме ${st.id.slice(-1)}`,
  text: "Мен 1940 жылы Үштөбеде дүниеге келдім.\nӘкем колхозда жұмыс істеді.",
  quote: "Құдайға шүкір.",
}));

describe("модель: третий язык (#340)", () => {
  it("без extraLangs / с пустым — модель та же, частей нет", () => {
    const base = composeBook({ ...DEMO_BOOK, voiceUrl, builtAt });
    expect(base.extras).toEqual([]);
    expect(composeBook({ ...DEMO_BOOK, voiceUrl, builtAt, extraLangs: [] })).toEqual(base);
  });

  it("RU + KR + докупленный казахский: часть kk в порядке глав, только главы с переводом", () => {
    const texts = kk.slice(1); // у первой главы перевода ещё нет
    const book = composeBook({ ...DEMO_BOOK, voiceUrl, builtAt, langs: ["ru", "ko", "kk"], texts, extraLangs: ["kk"] });
    expect(book.second).toBe("ko");
    expect(book.chapters.every((c) => c.textKo)).toBe(true); // разворот RU | KR не тронут
    expect(book.extras.map((p) => p.lang)).toEqual(["kk"]);
    const part = book.extras[0]!;
    expect(part.chapters.map((c) => c.id)).toEqual(book.chapters.map((c) => c.id).filter((id) => id !== DEMO_BOOK.stories[0]!.id));
    const legacy = part.chapters.at(-1)!;
    expect(legacy.block).toBe("Наказ"); // «Слова деда» — последней, как в книге
    expect(part.chapters[0]).toEqual(expect.objectContaining({ quote: "Құдайға шүкір.", text: expect.stringContaining("Үштөбеде") }));
  });

  it("RU + KZ + докупленный корейский: корейский — из колонок, подписи разделов по-корейски", () => {
    const book = composeBook({ ...DEMO_BOOK, voiceUrl, builtAt, langs: ["ru", "kk", "ko"], texts: kk, extraLangs: ["ko"] });
    expect(book.second).toBe("kk");
    const part = book.extras[0]!;
    expect(part.lang).toBe("ko");
    expect(part.chapters[0]!.title).toBe(DEMO_BOOK.stories.find((s) => s.id === part.chapters[0]!.id)!.title_ko);
    expect(part.chapters.at(-1)!.block).toBe("당부");
  });

  it("язык, который уже в базовой паре, второй раз не печатается", () => {
    expect(composeBook({ ...DEMO_BOOK, voiceUrl, builtAt, extraLangs: ["ko", "ru"] }).extras).toEqual([]);
  });
});

describe("PDF: третий язык (#340)", () => {
  it("RU + KR + KZ: страниц больше, есть «Қазақша», корейский шрифт на месте", async () => {
    const two = await renderBook({ ...DEMO_BOOK, voiceUrl, builtAt });
    const three = await renderBook({ ...DEMO_BOOK, voiceUrl, builtAt, langs: ["ru", "ko", "kk"], texts: kk, extraLangs: ["kk"] });
    expect(three.chapters).toBe(7);
    expect(three.pageCount).toBe(countPages(three.pdf));
    expect(three.pageCount).toBeGreaterThanOrEqual(two.pageCount + 1 + 7); // разделитель + 7 глав
    expect(three.pdf.toString("latin1")).toMatch(/NotoSerifKR/);
    expect(three.missingKorean).toEqual([]);
  }, 60_000);

  it("RU + KZ + KR: корейский шрифт появляется только ради докупленной части", async () => {
    const r = await renderBook({ ...DEMO_BOOK, voiceUrl, builtAt, langs: ["ru", "kk", "ko"], texts: kk, extraLangs: ["ko"] });
    expect(r.pdf.toString("latin1")).toMatch(/NotoSerifKR/);
    expect(r.missingKorean).toEqual([]);
  }, 60_000);
});
