import { describe, expect, it } from "vitest";
import { outputSchemas } from "./types";

// V1 (#38): модель пишет "year": null — глава не должна падать на проверке схемы.
describe("facts: null в year / relation", () => {
  const base = { text_ru: "Текст главы.", title: "Детство", quote: "Текст главы.", block: "childhood" };

  it("edit принимает null и отдаёт undefined", () => {
    const parsed = outputSchemas.edit.safeParse({
      ...base,
      facts: [{ type: "person", value: "мама", year: null, relation: null }],
    });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    if (parsed.success) {
      expect(parsed.data.facts[0]).toEqual({ type: "person", value: "мама" });
    }
  });

  it("год числом по-прежнему сохраняется", () => {
    const parsed = outputSchemas.edit.safeParse({ ...base, facts: [{ type: "date", value: "переезд", year: 1957 }] });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.facts[0]!.year).toBe(1957);
  });

  it("строка вместо года — всё ещё ошибка", () => {
    expect(outputSchemas.edit.safeParse({ ...base, facts: [{ type: "date", value: "x", year: "1957" }] }).success).toBe(false);
  });
});
