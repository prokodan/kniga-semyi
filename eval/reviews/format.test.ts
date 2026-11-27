// #232: выгрузка отзывов носителей, золотой набор, сверка «ближе / дальше».
import { describe, expect, it } from "vitest";
import type { ReviewFeedback, ReviewItem, ReviewLink } from "@/lib/types";
import {
  chrF,
  goldenFromLink,
  goldenKey,
  goldenLine,
  judgeGolden,
  mergeGolden,
  missingNumbers,
  parseGolden,
  renderGolden,
  renderReviewMarkdown,
  reviewFileName,
  wordDiff,
  type GoldenEntry,
} from "./format";

const LINK: ReviewLink = {
  id: "abcdef12-0000-0000-0000-000000000000",
  pair: "ru-ko",
  mode: "texts",
  reviewer_label: "А. К.",
  items_set: "demo",
  expires_at: "2026-12-11T00:00:00Z",
  revoked_at: null,
  created_at: "2026-11-27T08:00:00Z",
};

const ITEM: ReviewItem = {
  id: "i1",
  link_id: LINK.id,
  position: 0,
  kind: "chapter",
  source_lang: "ru",
  target_lang: "ko",
  title: "Корни",
  source_text: "В 1937 году нас повезли.\nМама плакала.",
  model_text: "1937년에 우리는 실려 갔다.\n어머님이 우셨다.",
  prompt_version: "translate abc",
  persona: "demo:kim",
};
const ITEM2: ReviewItem = { ...ITEM, id: "i2", position: 1, title: "Детство" };

const fb = (f: Partial<ReviewFeedback> & Pick<ReviewFeedback, "item_id" | "paragraph">): ReviewFeedback => ({
  edited_text: null,
  ratings: {},
  comment: null,
  skipped: false,
  updated_at: "2026-11-27T10:00:00Z",
  ...f,
});

const FEEDBACK = [
  fb({ item_id: "i1", paragraph: 1, edited_text: "어머니가 우셨다.", comment: "о своей маме — 어머니" }),
  fb({ item_id: "i1", paragraph: 0, edited_text: "1937년에 우리는 실려 갔다." }), // без изменений
  fb({ item_id: "i1", paragraph: -1, ratings: { meaning: 5, respect: 3 }, comment: "в целом хорошо" }),
];

describe("выгрузка", () => {
  it("имя файла: дата ссылки, пара, инициалы; повтор — с id", () => {
    const taken = new Set<string>();
    expect(reviewFileName(LINK, taken)).toBe("2026-11-27-ru-ko-ak.md");
    expect(reviewFileName(LINK, taken)).toBe("2026-11-27-ru-ko-ak-abcdef.md");
  });

  it("markdown: оценки, diff правки, комментарии; непроверенный текст не попадает", () => {
    const md = renderReviewMarkdown({ link: LINK, items: [ITEM, ITEM2], feedback: FEEDBACK });
    expect(md).toContain("# Отзывы носителя · ru-ko · А. К.");
    expect(md).toContain("Проверено: 1 из 2");
    expect(md).toContain("смысл 5 · к старшим 3");
    expect(md).toContain("- 어머님이 우셨다.");
    expect(md).toContain("+ 어머니가 우셨다.");
    expect(md).toContain("~~어머님이~~ **어머니가** 우셨다.");
    expect(md).toContain("💬 о своей маме — 어머니");
    expect(md).toContain("в целом хорошо");
    expect(md).not.toContain("### Абзац 1\n"); // абзац без правки и комментария не выводим
    expect(md).not.toContain("Детство");
  });

  it("пословный diff", () => {
    expect(wordDiff("a b c", "a x c")).toBe("a ~~b~~ **x** c");
    expect(wordDiff("a b", "a b d")).toBe("a b **d**");
    expect(wordDiff("a b", "b")).toBe("~~a~~ b");
  });
});

describe("золотой набор", () => {
  it("только настоящие правки абзацев", () => {
    const g = goldenFromLink({ link: LINK, items: [ITEM], feedback: FEEDBACK });
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({
      pair: "ru-ko",
      source: "Мама плакала.",
      model: "어머님이 우셨다.",
      gold: "어머니가 우셨다.",
      reviewer: "А. К.",
      persona: "demo:kim",
      comment: "о своей маме — 어머니",
      key: goldenKey("ru-ko", "Мама плакала.", "어머님이 우셨다."),
    });
  });

  it("слияние по key: поздняя правка заменяет, новые — в конец; jsonl туда-обратно", () => {
    const e = (key: string, gold: string, at: string): GoldenEntry => ({
      key,
      pair: "ru-ko",
      kind: "chapter",
      persona: "kim",
      title: null,
      source: "s",
      model: "m",
      gold,
      prompt_version: null,
      reviewer: "А.",
      reviewed_at: at,
    });
    const merged = mergeGolden([e("a", "1", "2026-11-01"), e("b", "2", "2026-11-01")], [e("a", "3", "2026-11-02"), e("c", "4", "2026-11-02"), e("b", "old", "2026-10-01")]);
    expect(merged.map((x) => `${x.key}${x.gold}`)).toEqual(["a3", "b2", "c4"]);
    expect(parseGolden(renderGolden(merged))).toEqual(merged);
    expect(renderGolden([])).toBe("");
  });
});

describe("сверка с золотым набором", () => {
  const entry: GoldenEntry = {
    key: "k",
    pair: "ru-ko",
    kind: "chapter",
    persona: "kim",
    title: null,
    source: "В 1937 году мама плакала.",
    model: "1937년에 어머님이 우셨다.",
    gold: "1937년에 어머니가 우셨다.",
    prompt_version: null,
    reviewer: "А.",
    reviewed_at: "2026-11-27",
  };

  it("chrF: совпадение 1, чужой текст ~0", () => {
    expect(chrF("어머니가 우셨다", "어머니가 우셨다")).toBeCloseTo(1);
    expect(chrF("abc", "xyz")).toBe(0);
    expect(chrF("", "")).toBe(1);
  });

  it("ближе / как было / дальше и потерянные числа", () => {
    expect(judgeGolden(entry, "1937년에 어머니가 우셨다.").verdict).toBe("closer");
    expect(judgeGolden(entry, "1937년에 어머님이 우셨다.").verdict).toBe("same");
    const far = judgeGolden(entry, "엄마가 울었다.");
    expect(far.verdict).toBe("farther");
    expect(far.missing).toEqual(["1937"]);
    expect(missingNumbers("1937년 3명", "1937년")).toEqual(["3"]);
  });

  it("строка для комментария eval", () => {
    expect(goldenLine("ru-ko", [])).toContain("золотой набор пуст");
    const ok = goldenLine("ru-ko", [judgeGolden(entry, "1937년에 어머니가 우셨다.")]);
    expect(ok).toContain("🟢");
    expect(ok).toContain("ближе 1 / дальше 0 / как было 0 из 1");
    expect(goldenLine("ru-ko", [judgeGolden(entry, "엄마가 울었다.")])).toContain("🔴 по фактам: kim (нет 1937)");
  });
});
