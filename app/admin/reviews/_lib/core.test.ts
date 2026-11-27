// #232: ссылки носителей — токен, инициалы, отзыв, статистика.
import { describe, expect, it } from "vitest";
import type { ReviewFeedback } from "@/lib/types";
import {
  FeedbackError,
  TOKEN_RE,
  alignParagraphs,
  hashReviewToken,
  isRealEdit,
  labelSlug,
  linkStats,
  linkStatus,
  newReviewToken,
  pairLangs,
  parseFeedback,
  reviewerLabel,
} from "./core";

const ITEM = "11111111-2222-3333-4444-555555555555";

describe("токен", () => {
  it("32 символа base64url, хэш — sha256 hex, токен в хэше не виден", () => {
    const t = newReviewToken();
    expect(t).toMatch(TOKEN_RE);
    expect(newReviewToken()).not.toBe(t);
    const h = hashReviewToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(t);
    expect(hashReviewToken(t)).toBe(h);
  });
});

describe("инициалы и имя файла", () => {
  it("полное имя → инициалы; инициалы — как есть", () => {
    expect(reviewerLabel("Айгерим Касымова")).toBe("А. К.");
    expect(reviewerLabel("а.к.")).toBe("А. К.");
    expect(reviewerLabel("김 민 지")).toBe("김. 민. 지.");
    expect(reviewerLabel("  ")).toBe("");
    expect(reviewerLabel("1234")).toBe("");
  });
  it("slug для файла: кириллица и казахские буквы — латиницей", () => {
    expect(labelSlug("А. К.")).toBe("ak");
    expect(labelSlug("Ә. Ұ.")).toBe("au");
    expect(labelSlug("J. S.")).toBe("js");
    expect(labelSlug("김.")).toBe("x");
  });
  it("пара → языки", () => {
    expect(pairLangs("ru-kk")).toEqual({ from: "ru", to: "kk" });
  });
});

describe("абзацы", () => {
  it("по переводам строк, лишние — с пустой парой", () => {
    expect(alignParagraphs("а\n\nб\nв", "A\nB")).toEqual([
      { source: "а", target: "A" },
      { source: "б", target: "B" },
      { source: "в", target: "" },
    ]);
  });
  it("правка = текст отличается не только пробелами", () => {
    expect(isRealEdit("어머니가  왔다", "어머니가 왔다 ")).toBe(false);
    expect(isRealEdit("어머니가 왔다", "어머니께서 오셨다")).toBe(true);
    expect(isRealEdit("x", null)).toBe(false);
  });
});

describe("статус ссылки", () => {
  const now = new Date("2026-11-27T10:00:00Z");
  it("активна / истекла / отозвана", () => {
    expect(linkStatus({ expires_at: "2026-12-01T00:00:00Z", revoked_at: null }, now)).toBe("active");
    expect(linkStatus({ expires_at: "2026-11-27T09:00:00Z", revoked_at: null }, now)).toBe("expired");
    expect(linkStatus({ expires_at: "2026-12-01T00:00:00Z", revoked_at: "2026-11-26T00:00:00Z" }, now)).toBe("revoked");
  });
});

describe("parseFeedback", () => {
  it("правка абзаца", () => {
    expect(parseFeedback({ item_id: ITEM, paragraph: 2, edited_text: " 고쳤다\r\n ", comment: "", extra: 1 })).toEqual({
      item_id: ITEM,
      paragraph: 2,
      edited_text: "고쳤다",
      ratings: {},
      comment: null,
      skipped: false,
    });
  });
  it("оценки — только на весь текст, 1–5", () => {
    expect(parseFeedback({ item_id: ITEM, paragraph: -1, ratings: { meaning: 4, names: null, junk: 9 }, skipped: true }).ratings).toEqual({ meaning: 4 });
    expect(() => parseFeedback({ item_id: ITEM, paragraph: 0, ratings: { meaning: 4 } })).toThrow(FeedbackError);
    expect(() => parseFeedback({ item_id: ITEM, paragraph: -1, ratings: { meaning: 6 } })).toThrow(FeedbackError);
    expect(() => parseFeedback({ item_id: ITEM, paragraph: -1, ratings: { meaning: 2.5 } })).toThrow(FeedbackError);
  });
  it("плохие поля", () => {
    expect(() => parseFeedback(null)).toThrow(FeedbackError);
    expect(() => parseFeedback({ item_id: "x", paragraph: 0 })).toThrow(FeedbackError);
    expect(() => parseFeedback({ item_id: ITEM, paragraph: -2 })).toThrow(FeedbackError);
    expect(() => parseFeedback({ item_id: ITEM, paragraph: -1, edited_text: "текст" })).toThrow(FeedbackError);
    expect(() => parseFeedback({ item_id: ITEM, paragraph: 0, comment: "x".repeat(2001) })).toThrow(FeedbackError);
  });
});

describe("linkStats", () => {
  const items = [
    { id: "a", model_text: "첫째\n둘째" },
    { id: "b", model_text: "셋째" },
    { id: "c", model_text: "넷째" },
  ];
  const fb = (f: Partial<ReviewFeedback> & Pick<ReviewFeedback, "item_id" | "paragraph">): ReviewFeedback => ({
    edited_text: null,
    ratings: {},
    comment: null,
    skipped: false,
    updated_at: "2026-11-27T10:00:00Z",
    ...f,
  });
  it("проверено, правки, средние", () => {
    const s = linkStats(items, [
      fb({ item_id: "a", paragraph: 1, edited_text: "둘째 고침" }),
      fb({ item_id: "a", paragraph: 0, edited_text: "첫째" }), // не правка — как у модели
      fb({ item_id: "a", paragraph: -1, ratings: { meaning: 4, grammar: 3 } }),
      fb({ item_id: "b", paragraph: -1, ratings: { meaning: 5 }, comment: "хорошо", updated_at: "2026-11-27T11:00:00Z" }),
      fb({ item_id: "c", paragraph: -1, skipped: true }),
      fb({ item_id: "zzz", paragraph: -1, ratings: { meaning: 1 } }), // чужой текст
    ]);
    expect(s).toMatchObject({ items: 3, reviewed: 3, skipped: 1, edits: 1, comments: 1, lastAt: "2026-11-27T11:00:00Z" });
    expect(s.avg).toEqual({ meaning: 4.5, grammar: 3 });
  });
});
