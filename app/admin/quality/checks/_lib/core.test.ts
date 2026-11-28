// #353: /review 2.0 — фокус-слова, подсветка, diff правки, прогресс «N из M», фаза ссылки, отзыв со словами.
import { describe, expect, it } from "vitest";
import {
  CRITERIA,
  TERMS_MAX,
  detectFocusTerms,
  estimateMinutes,
  highlightSegments,
  itemState,
  linkPhase,
  nuanceTags,
  progressCount,
  wordDiff,
} from "./core";
import { FeedbackError, parseCheckFeedback } from "./feedback";

const ITEM = "11111111-2222-3333-4444-555555555555";

describe("фокус-слова", () => {
  it("корейский: родство, реалии, даты по порядку; 아버지 внутри 할아버지 не считается, второе вхождение — да", () => {
    const t = detectFocusTerms("할아버지는 1937년에 극동에서 왔고, 아버지 쪽 할머니는 김치를 담갔다.", "ko").map((x) => x.term);
    expect(t).toEqual(["할아버지", "1937년", "극동", "아버지", "할머니", "김치"]);
  });

  it("казахский: основа + окончание, короткие основы без чужих слов, «вы» по окончанию", () => {
    const t = detectFocusTerms("Апам бізге бауырсақ пісіретін, анау үйде. Әкем шахтаға барды, білесіздер ме, сенім жоқ.", "kk").map((x) => x.term);
    expect(t).toContain("Апам");
    expect(t).toContain("Әкем");
    expect(t).toContain("шахтаға");
    expect(t).toContain("білесіздер");
    expect(t).not.toContain("анау");
    expect(t).not.toContain("сенім");
  });

  it("не больше 8, родство важнее дат", () => {
    const text = "1941년 1942년 1943년 1944년 1945년 1946년 1947년 1948년 1949년 할머니";
    const t = detectFocusTerms(text, "ko");
    expect(t).toHaveLength(TERMS_MAX);
    expect(t.map((x) => x.term)).toContain("할머니");
  });

  it("подсказка по-русски у каждого слова", () => {
    for (const t of detectFocusTerms("우리 오마니는 아궁이 곁에서 국수를 끓였다.", "ko")) expect(t.hint).toBeTruthy();
  });

  it("подсветка: все вхождения, длинное слово не режется коротким", () => {
    const seg = highlightSegments("할아버지와 아버지, 또 아버지", [{ term: "아버지" }, { term: "할아버지" }]);
    expect(seg.filter((s) => s.term !== null).map((s) => [s.text, s.term])).toEqual([
      ["할아버지", 1],
      ["아버지", 0],
      ["아버지", 0],
    ]);
    expect(seg.map((s) => s.text).join("")).toBe("할아버지와 아버지, 또 아버지");
  });
});

describe("теги нюансов", () => {
  it("родство, даты, советские реалии, корё мар", () => {
    expect(nuanceTags("Омани в 1937-м переселили из-под Посьета, жили в колхозе.")).toEqual(
      expect.arrayContaining(["родство", "даты и числа", "советские реалии", "корё мар"]),
    );
    expect(nuanceTags("Учительница.")).toEqual([]);
  });
});

describe("diff правки", () => {
  it("по словам: было → стало, склейка без потерь", () => {
    const d = wordDiff("내 남동생은 42년에 갔다.", "우리 형은 42년에 갔다.");
    expect(d.filter((x) => x.op === "del").map((x) => x.text)).toEqual(["내", "남동생은"]);
    expect(d.filter((x) => x.op === "add").map((x) => x.text)).toEqual(["우리", "형은"]);
    expect(d.filter((x) => x.op !== "add").map((x) => x.text).join("")).toBe("내 남동생은 42년에 갔다.");
    expect(d.filter((x) => x.op !== "del").map((x) => x.text).join("")).toBe("우리 형은 42년에 갔다.");
  });
  it("без изменений — один кусок same", () => {
    expect(wordDiff("a b", "a b")).toEqual([{ op: "same", text: "a b" }]);
  });
});

describe("прогресс «N из M»", () => {
  const item = { id: ITEM, targets: ["첫 문단", "둘째 문단"], termCount: 3 };
  const fb = (o: Partial<Parameters<typeof itemState>[2][number]>) => [
    { item_id: ITEM, paragraph: -1, edited_text: null, ratings: {}, comment: null, skipped: false, ...o },
  ];

  it("текст: готов, когда оценены все 5 критериев; правка абзаца — начат", () => {
    expect(itemState("text", item, [])).toBe("empty");
    expect(itemState("text", item, fb({ ratings: { meaning: 4 } }))).toBe("partial");
    expect(itemState("text", item, [{ item_id: ITEM, paragraph: 1, edited_text: "고친 문단", ratings: {}, comment: null, skipped: false }])).toBe("partial");
    expect(itemState("text", item, [{ item_id: ITEM, paragraph: 1, edited_text: "둘째  문단", ratings: {}, comment: null, skipped: false }])).toBe("empty");
    const all = Object.fromEntries(CRITERIA.map((c) => [c, 5]));
    expect(itemState("text", item, fb({ ratings: all }))).toBe("done");
    expect(itemState("text", item, fb({ skipped: true }))).toBe("skipped");
  });

  it("слова: готов, когда отвечено про каждое слово", () => {
    expect(itemState("terms", item, fb({ terms: { "0": { ok: true } } }))).toBe("partial");
    expect(itemState("terms", item, fb({ terms: { "0": { ok: true }, "1": { ok: false, fix: "형" }, "2": { ok: null } } }))).toBe("partial");
    expect(itemState("terms", item, fb({ terms: { "0": { ok: true }, "1": { ok: false, fix: "형" }, "2": { ok: true } } }))).toBe("done");
  });

  it("фаза ссылки: открыта → в работе → готово (все тексты или «Готово» на итоге)", () => {
    expect(linkPhase(["empty", "empty"], null)).toBe("open");
    expect(linkPhase(["partial", "empty"], null)).toBe("work");
    expect(linkPhase(["done", "skipped"], null)).toBe("done");
    expect(linkPhase(["done", "empty"], "2026-11-28T10:00:00Z")).toBe("done");
    expect(progressCount(["done", "skipped", "partial"])).toEqual({ done: 2, total: 3 });
  });

  it("сколько займёт: 10 текстов ≈ 15–20 мин, слова быстрее", () => {
    expect(estimateMinutes("text", 10)).toEqual([15, 20]);
    expect(estimateMinutes("terms", 10)).toEqual([5, 10]);
    expect(estimateMinutes("text", 1)).toEqual([5, 10]);
  });
});

describe("отзыв со словами", () => {
  it("слова — только на весь текст, номера 0…7, ok да / нет / пусто, «как правильно» — только у «неверно»", () => {
    const r = parseCheckFeedback({ item_id: ITEM, paragraph: -1, terms: { "0": { ok: true, fix: "x" }, "1": { ok: false, fix: "  형  " }, "2": { ok: null } } });
    expect(r.terms).toEqual({ "0": { ok: true, fix: null }, "1": { ok: false, fix: "형" }, "2": { ok: null, fix: null } });
    expect(() => parseCheckFeedback({ item_id: ITEM, paragraph: 0, terms: { "0": { ok: true } } })).toThrow(FeedbackError);
    expect(() => parseCheckFeedback({ item_id: ITEM, paragraph: -1, terms: { "9": { ok: true } } })).toThrow(FeedbackError);
    expect(() => parseCheckFeedback({ item_id: ITEM, paragraph: -1, terms: { "0": { ok: "да" } } })).toThrow(FeedbackError);
    expect(() => parseCheckFeedback({ item_id: ITEM, paragraph: -1, terms: { "0": { ok: false, fix: "x".repeat(201) } } })).toThrow(FeedbackError);
  });
  it("без слов — как #232 (terms = null)", () => {
    expect(parseCheckFeedback({ item_id: ITEM, paragraph: -1, ratings: { meaning: 3 } }).terms).toBeNull();
    expect(() => parseCheckFeedback({ item_id: ITEM, paragraph: 0, ratings: { meaning: 3 } })).toThrow(FeedbackError);
  });
});
