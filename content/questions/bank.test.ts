import { describe, expect, it } from "vitest";
import { LIFE_BLOCKS } from "@/lib/types";
import { QUESTIONS } from "./bank";
import { BLOCKS } from "./blocks";

describe("банк вопросов", () => {
  it("id уникальны и вида <block>-NN", () => {
    const ids = QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const q of QUESTIONS) expect(q.id).toMatch(new RegExp(`^${q.block}-\\d{2}$`));
  });

  it("у каждого вопроса RU, KR и минимум 2–5 пунктов", () => {
    for (const q of QUESTIONS) {
      expect(q.ru.length, q.id).toBeGreaterThan(10);
      expect(q.ko.length, q.id).toBeGreaterThan(5);
      expect(q.minimum.length, q.id).toBeGreaterThanOrEqual(2);
      expect(q.minimum.length, q.id).toBeLessThanOrEqual(5);
    }
  });

  it("каждый блок карты жизни покрыт и описан", () => {
    expect(BLOCKS.map((b) => b.id)).toEqual([...LIFE_BLOCKS]);
    for (const block of LIFE_BLOCKS) expect(QUESTIONS.some((q) => q.block === block), block).toBe(true);
  });
});
