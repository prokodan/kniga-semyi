import { describe, expect, it } from "vitest";
import { DEMO_STORIES } from "./pdf/demo";
import { bookLangs, chapterText, mirrorRows, withStoryTexts, type StoryTextRow } from "./texts";

const story = { id: "s1", text_ru: "Текст", title: "Название", quote: "Цитата", text_ko: "글", title_ko: "제목", quote_ko: "인용" };

describe("тексты главы по языкам (#230)", () => {
  it("строки нет — старые колонки (как сейчас)", () => {
    expect(chapterText(story, [], "ru")).toEqual({ title: "Название", text: "Текст", quote: "Цитата" });
    expect(chapterText(story, [], "ko")).toEqual({ title: "제목", text: "글", quote: "인용" });
    expect(chapterText(story, [], "kk")).toEqual({ title: null, text: null, quote: null });
    expect(withStoryTexts(story, [])).toEqual(story);
  });

  it("строка есть — она (только своей главы и своего языка)", () => {
    const rows: StoryTextRow[] = [
      { story_id: "s1", lang: "ru", title: "Вычитано", text: "Новый", quote: "Ц" },
      { story_id: "s2", lang: "ko", title: "x", text: "x", quote: "x" },
      { story_id: "s1", lang: "kk", title: "Атауы", text: "Мәтін", quote: null },
    ];
    expect(withStoryTexts(story, rows)).toEqual({ ...story, title: "Вычитано", text_ru: "Новый", quote: "Ц" });
    expect(chapterText(story, rows, "kk").text).toBe("Мәтін");
  });

  it("зеркало колонок → строки = колонки при чтении (демо-главы не меняются)", () => {
    for (const s of DEMO_STORIES) expect(withStoryTexts(s, mirrorRows(s)), s.id).toEqual(s);
    expect(mirrorRows({ ...story, text_ko: null, title_ko: null, quote_ko: null }).map((r) => r.lang)).toEqual(["ru"]);
  });

  it("языки книги: по умолчанию ru, ko; мусор и повторы отбрасываются; не больше двух", () => {
    expect(bookLangs(null)).toEqual(["ru", "ko"]);
    expect(bookLangs({})).toEqual(["ru", "ko"]);
    expect(bookLangs({ book_langs: [] })).toEqual(["ru", "ko"]);
    expect(bookLangs({ book_langs: ["ru"] })).toEqual(["ru"]);
    expect(bookLangs({ book_langs: ["ru", "xx", "ru", "kk", "ko"] })).toEqual(["ru", "kk"]);
  });
});
