import { describe, expect, it } from "vitest";
import { bookCost, percentile, type BookCostUsage } from "./book-cost";

const story = (id: string, family_id: string, status = "ready", parent_story_id: string | null = null) => ({
  id,
  family_id,
  status,
  parent_story_id,
});

describe("#105 п. 6: себестоимость книги", () => {
  it("перцентиль — линейная интерполяция; пусто — 0", () => {
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([10], 0.9)).toBe(10);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([5, 1, 3, 2, 4, 6, 7, 8, 9, 10], 0.9)).toBeCloseTo(9.1);
  });

  it("семьи с готовой главой; семья строки — family_id или история; кэш не запрос; демо и без глав — мимо", () => {
    const stories = [
      story("a1", "A"),
      story("a1-f", "A", "ready", "a1"), // уточнение — не глава
      story("a2", "A"),
      story("b1", "B"),
      story("c1", "C", "failed"), // ни одной готовой главы
      story("d1", "D"), // демо
    ];
    const families = [{ id: "A" }, { id: "B" }, { id: "C" }, { id: "D", is_demo: true }];
    const usage: BookCostUsage[] = [
      { story_id: "a1", status: "ok", cost_usd: "0.01" },
      { story_id: "a1", status: "cache_hit", cost_usd: 0 },
      { story_id: "a2", status: "timeout", cost_usd: 0 },
      { story_id: null, family_id: "A", status: "ok", cost_usd: 0.05 }, // сказка (#204)
      { story_id: "b1", status: "ok", cost_usd: 0.002 },
      { story_id: "c1", status: "ok", cost_usd: 1 },
      { story_id: "d1", status: "ok", cost_usd: 1 },
      { story_id: null, status: "ok", cost_usd: 3 }, // без семьи
      { story_id: "b1", status: "ok", cost_usd: 0.5, env: "staging" },
    ];
    const [prod, staging] = bookCost({ usage, stories, families });
    expect(prod).toMatchObject({ env: "prod", families: 2 });
    // A: 3 запроса, $0.06, 2 главы; B: 1 запрос, $0.002, 1 глава
    expect(prod!.requests).toEqual({ median: 2, p90: 2.8 });
    expect(prod!.usd).toEqual({ median: 0.031, p90: 0.0542 });
    expect(prod!.chapters).toEqual({ median: 1.5, p90: 1.9 });
    expect(prod!.usdPerChapter).toBe(0.0207);
    expect(staging).toMatchObject({ env: "staging", families: 1, usd: { median: 0.5, p90: 0.5 } });
  });

  it("нет данных — нули, без деления на ноль", () => {
    const [prod] = bookCost({ usage: [], stories: [], families: [] });
    expect(prod).toEqual({
      env: "prod",
      families: 0,
      requests: { median: 0, p90: 0 },
      usd: { median: 0, p90: 0 },
      chapters: { median: 0, p90: 0 },
      usdPerChapter: 0,
    });
  });
});
