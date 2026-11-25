import { describe, expect, it } from "vitest";
import { planSpellings, similarity, translitName, type SpellingChapter, type SpellingEntity } from "./spellings";

const ch = (id: string, day: number, text_ru: string, text_ko: string, extra: Partial<SpellingChapter> = {}): SpellingChapter => ({
  id,
  created_at: `2026-11-${String(day).padStart(2, "0")}T10:00:00Z`,
  title: null,
  quote: null,
  text_ru,
  title_ko: null,
  quote_ko: null,
  text_ko,
  ...extra,
});
const person = (id: string, name_ru: string, name_ko: string | null = null, source: SpellingEntity["source"] = "auto"): SpellingEntity => ({
  id,
  kind: "person",
  name_ru,
  name_ko,
  source,
});

describe("#155 похожесть написаний", () => {
  it("렌나 ≈ 레나, 안나 ≠ 언니, разное число слов — 0", () => {
    expect(similarity("렌나", "레나")).toBeGreaterThanOrEqual(0.75);
    expect(similarity("안나", "언니")).toBeLessThan(0.75);
    expect(similarity("안나 페트로브나", "안나")).toBe(0);
    expect(translitName("Анна Петровна")).toBe("안나 페트로프나");
    expect(translitName("Лена")).toBe("레나");
  });
});

describe("#155 план пакетной поправки", () => {
  it("словарь пуст → самый частый вариант; остальные главы приводятся к нему, частицы целы", () => {
    const chapters = [
      ch("a", 1, "Лена пришла. Лена ушла.", "렌나가 왔다. 렌나는 갔다."),
      ch("b", 2, "Лена пела. Лена смеялась. Лену любили.", "레나가 노래했다. 레나는 웃었다. 모두 레나를 사랑했다."),
    ];
    const plan = planSpellings([person("e1", "Лена")], chapters);
    expect(plan.entities).toEqual([{ id: "e1", kind: "person", to: "레나", learn: true, variants: [{ ko: "렌나", count: 2 }], chapters: 1, skipped: 0 }]);
    expect(plan.chapters).toHaveLength(1);
    expect(plan.chapters[0]!.text_ko).toBe("레나가 왔다. 레나는 갔다.");
  });

  it("написание словаря (правка семьи) важнее частоты", () => {
    const chapters = [
      ch("a", 1, "Лена пришла. Лена ушла.", "렌나가 왔다. 렌나는 갔다."),
      ch("b", 2, "Лена пела.", "레나가 노래했다."),
    ];
    const plan = planSpellings([person("e1", "Лена", "렌나", "family")], chapters);
    expect(plan.entities[0]).toMatchObject({ to: "렌나", learn: false, chapters: 1 });
    expect(plan.chapters.map((c) => c.text_ko)).toEqual(["렌나가 노래했다."]);
  });

  it("заголовок и цитата тоже, одно написание — ничего не меняется", () => {
    const chapters = [
      ch("a", 1, "Лена пришла.", "레나가 왔다.", { title: "Лена", title_ko: "레나" }),
      ch("b", 2, "Лена ушла.", "렌나는 갔다.", { title: "Про Лену", title_ko: "렌나 이야기", quote: "Лена!", quote_ko: "렌나!" }),
    ];
    const plan = planSpellings([person("e1", "Лена", "레나")], chapters);
    const b = plan.chapters.find((c) => c.id === "b")!;
    expect([b.title_ko, b.quote_ko, b.text_ko]).toEqual(["레나 이야기", "레나!", "레나는 갔다."]);
    expect(planSpellings([person("e1", "Лена", "레나")], [chapters[0]!]).chapters).toEqual([]);
  });

  it("обычное слово не трогаем: вариант встречается в главе без имени; вариантов больше, чем упоминаний", () => {
    // 안내 (≈ 안나) — «объявление»: есть в главе, где Анны нет
    const common = [
      ch("a", 1, "Анна пришла.", "안나가 왔다."),
      ch("b", 2, "Анна читала объявление.", "안나는 안내를 읽었다."),
      ch("c", 3, "На вокзале было объявление.", "역에 안내가 있었다."),
    ];
    const p1 = planSpellings([person("e1", "Анна", "안나")], common);
    expect(p1.chapters).toEqual([]);
    // вариант чаще, чем имя в русском → глава пропускается
    const many = [ch("a", 1, "Лена пришла.", "레나가 왔다. 렌나 렌나 렌나.")];
    const p2 = planSpellings([person("e1", "Лена", "레나")], many);
    expect(p2.chapters).toEqual([]);
    expect(p2.entities[0]).toMatchObject({ chapters: 0, skipped: 1 });
  });

  it("слова корё мар и однослоговые имена не трогаем; два похожих имени — не путаем", () => {
    const words: SpellingEntity = { id: "w", kind: "word", name_ru: "аппади", name_ko: "아버지", source: "auto" };
    const plan = planSpellings([words, person("k", "Ким", "김")], [ch("a", 1, "Аппади Ким.", "아파디 킴.")]);
    expect(plan).toEqual({ entities: [], chapters: [] });
    const two = planSpellings(
      [person("l", "Лена", "레나"), person("r", "Рена", "레나")],
      [ch("a", 1, "Лена и Рена.", "렌나와 레나.")],
    );
    expect(two.chapters).toEqual([]);
  });

  it("имя из двух слов — целиком", () => {
    const plan = planSpellings(
      [person("e1", "Анна Петровна", "안나 페트로브나")],
      [ch("a", 1, "Анна Петровна учила нас.", "안나 페트로프나는 우리를 가르치셨다.")],
    );
    expect(plan.chapters[0]!.text_ko).toBe("안나 페트로브나는 우리를 가르치셨다.");
  });
});
