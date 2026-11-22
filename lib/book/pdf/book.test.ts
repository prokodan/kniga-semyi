import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEMO_BOOK, DEMO_STORIES } from "./demo";
import { missingKorean } from "./fonts";
import { composeBook, guessElder, isBookChapter, orderChapters, paragraphs, type ChapterStory } from "./model";
import { countPages, renderBook } from "./render";

const voiceUrl = (id: string) => `https://kniga.example/listen/${id}?s=AAAAAAAAAAAAAAAAAAAAAA`;

describe("модель книги", () => {
  it("главы по блокам карты жизни, legacy — отдельным разделом в конце", () => {
    const shuffled = [...DEMO_STORIES].reverse();
    const book = composeBook({ ...DEMO_BOOK, stories: shuffled, voiceUrl });
    expect(book.chapters.map((c) => c.block)).toEqual(["roots", "childhood", "youth", "work", "love", "traditions", "legacy"]);
    expect(book.groups.map((g) => g.ru)).toEqual(["Корни", "Детство", "Юность и учёба", "Работа и дело", "Любовь и семья", "Традиции и кухня"]);
    expect(book.legacy.ru).toBe("Слова деда");
    expect(book.legacy.chapters).toHaveLength(1);
    expect(book.years).toBe("род. 1940");
    expect(book.chapters[0]!.voiceUrl).toContain("/listen/");
  });

  it("не берёт неготовые главы, ответы на уточнения и пустые тексты", () => {
    const one = DEMO_STORIES[0]!;
    const extra: ChapterStory[] = [
      { ...one, id: "a", status: "editing" },
      { ...one, id: "b", parent_story_id: one.id },
      { ...one, id: "c", text_ru: "  " },
    ];
    expect(extra.filter(isBookChapter)).toHaveLength(0);
  });

  it("внутри блока — sort_order, затем время записи", () => {
    const a = { ...DEMO_STORIES[1]!, id: "a", sort_order: 2, created_at: "2026-01-01" };
    const b = { ...DEMO_STORIES[1]!, id: "b", sort_order: 1, created_at: "2026-02-01" };
    const c = { ...DEMO_STORIES[1]!, id: "c", sort_order: null, created_at: "2025-01-01" };
    expect(orderChapters([a, c, b]).map((s) => s.id)).toEqual(["b", "a", "c"]);
  });

  it("дед или бабушка по имени", () => {
    expect(guessElder("Ким Чер Су")).toBe("grandfather");
    expect(guessElder("Пак Мария Николаевна")).toBe("grandmother");
    expect(guessElder("Бабушка Мария")).toBe("grandmother");
    expect(guessElder("Цой Валентина Ивановна")).toBe("grandmother");
    expect(guessElder("Тен Иван Петрович")).toBe("grandfather");
    const book = composeBook({ ...DEMO_BOOK, voiceUrl, elder: "grandmother" });
    expect(book.legacy).toEqual(expect.objectContaining({ ru: "Слова бабушки", ko: "할머니의 말씀" }));
  });

  it("абзацы", () => {
    expect(paragraphs("Раз.\n\n  Два  три.\nЧетыре")).toEqual(["Раз.", "Два три.", "Четыре"]);
    expect(paragraphs(null)).toEqual([]);
  });
});

describe("шрифты", () => {
  it("демо-тексты целиком покрыты корейским подмножеством", () => {
    const ko = DEMO_STORIES.map((s) => `${s.title_ko} ${s.quote_ko} ${s.text_ko}`).join(" ");
    expect(missingKorean(ko)).toEqual([]);
    expect(missingKorean("똠방각하")).toEqual(["똠"]); // слог вне KS X 1001 — попадёт в лог сборки
  });
});

describe("PDF", () => {
  it("собирает A5 из 7 глав: шрифты встроены, номера в оглавлении, разумный вес", async () => {
    const r = await renderBook({ ...DEMO_BOOK, voiceUrl });
    if (process.env.BOOK_DEMO_OUT) writeFileSync(process.env.BOOK_DEMO_OUT, r.pdf);
    const raw = r.pdf.toString("latin1");
    expect(raw.startsWith("%PDF-")).toBe(true);
    expect(r.chapters).toBe(7);
    expect(r.pageCount).toBe(countPages(r.pdf));
    expect(r.pageCount).toBeGreaterThanOrEqual(1 + 1 + 7 * 2);
    expect(raw).toMatch(/NotoSerifKR-Regular/); // корейский шрифт встроен подмножеством
    expect(raw).toMatch(/\/MediaBox \[0 0 419\.5\d* 595\.2\d*\]/); // A5
    expect(r.pdf.length).toBeLessThan(1_000_000);
    expect(r.missingKorean).toEqual([]);
    console.info(`[book] демо: ${r.pageCount} стр., ${Math.round(r.pdf.length / 1024)} КБ, ${r.ms} мс`);
  }, 60_000);

  it("без готовых глав — понятная ошибка", async () => {
    await expect(renderBook({ ...DEMO_BOOK, stories: [], voiceUrl })).rejects.toThrow(/нет готовых глав/);
  });
});
