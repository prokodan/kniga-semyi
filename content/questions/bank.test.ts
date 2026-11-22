import { readFileSync } from "node:fs";
import { join } from "node:path";
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

  it("ровно 5 вопросов в каждом блоке, номера 01–05 по порядку", () => {
    expect(QUESTIONS).toHaveLength(LIFE_BLOCKS.length * 5);
    for (const block of LIFE_BLOCKS) {
      const ids = QUESTIONS.filter((q) => q.block === block).map((q) => q.id);
      expect(ids, block).toEqual([1, 2, 3, 4, 5].map((n) => `${block}-0${n}`));
    }
  });

  it("первые вопросы блоков лёгкие: без войны, переселения и потерь", () => {
    const heavy = /войн|переселен|депортац|потер|умер|смерт|скучаете/i;
    for (const block of LIFE_BLOCKS) {
      const first = QUESTIONS.find((q) => q.id === `${block}-01`)!;
      expect(first.ru, first.id).not.toMatch(heavy);
    }
  });

  it("трудные темы только в hardship и с разрешением не отвечать", () => {
    for (const q of QUESTIONS.filter((x) => /войн|переселен/i.test(x.ru))) {
      expect(q.block, q.id).toBe("hardship");
      expect(q.ru, q.id).toMatch(/можно не отвечать|только то, чем хочется|можно пропустить/);
    }
  });

  it("traditions: корё мар, еда, праздники; legacy: «Слова деда»", () => {
    const t = QUESTIONS.filter((q) => q.block === "traditions").map((q) => q.ru).join(" ");
    expect(t).toMatch(/корё мар/);
    expect(t).toMatch(/блюд|чимчи|кукси/);
    expect(t).toMatch(/праздник/);
    expect(QUESTIONS.some((q) => q.block === "legacy" && /Слова деда/.test(q.ru))).toBe(true);
  });

  it("корейский в вежливой форме (요 / 습니다)", () => {
    for (const q of QUESTIONS) expect(q.ko, q.id).toMatch(/(요|니다|니까)[?.]?$/);
  });

  it("шпаргалка ko-review.md совпадает с банком", () => {
    const md = readFileSync(join(__dirname, "ko-review.md"), "utf8");
    const rows = md.split("\n").filter((l) => /^\| \d+ \|/.test(l));
    expect(rows).toHaveLength(QUESTIONS.length);
    QUESTIONS.forEach((q, i) => {
      const cells = rows[i]!.split(" | ").map((c) => c.trim());
      expect(cells[1], `строка ${i + 1}`).toBe(`\`${q.id}\``);
      expect(cells[3], q.id).toBe(q.ru);
      expect(cells[4], q.id).toBe(q.ko);
    });
  });
});
