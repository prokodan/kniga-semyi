// #101: строка прогресса и состояние разделов в полосе.
import { describe, expect, it } from "vitest";
import { LIFE_BLOCKS } from "@/lib/types";
import { blockState, localProgress, progressLine } from "./progress-line";

describe("#101 строка прогресса интервью", () => {
  const p = { block: { id: "childhood" as const, position: 2, total: 5 }, followups: { asked: 1, max: 3 }, doneBlocks: ["roots" as const] };

  it("вопрос: «Вопрос 2 из 5 в разделе „Детство“»", () => {
    expect(progressLine(p, "question", "Детство")).toBe("Вопрос 2 из 5 в разделе «Детство»");
  });
  it("уточнение: «… · уточнение 1 из 3»", () => {
    expect(progressLine(p, "followup", "Детство")).toBe("Вопрос 2 из 5 в разделе «Детство» · уточнение 1 из 3");
  });
  it("переспрос имени (уточнений ещё 0) и старый ответ без progress — без цифр, но с разделом", () => {
    expect(progressLine({ ...p, followups: { asked: 0, max: 3 } }, "followup", "Детство")).toBe("Вопрос 2 из 5 в разделе «Детство» · уточнение");
    expect(progressLine(undefined, "question", "Корни")).toBe("Раздел «Корни»");
  });
  it("полоса: текущий — жёлтый, пройденные ✓, будущие приглушённо", () => {
    expect(blockState("childhood", LIFE_BLOCKS, "childhood", ["roots"])).toBe("current");
    expect(blockState("roots", LIFE_BLOCKS, "childhood", ["roots"])).toBe("done");
    expect(blockState("youth", LIFE_BLOCKS, "childhood", ["roots"])).toBe("future");
    // без данных движка — разделы до текущего считаем пройденными (идём по порядку)
    expect(blockState("roots", LIFE_BLOCKS, "childhood", [])).toBe("done");
  });
  it("запасной путь по банку: позиция в разделе и пройденные разделы", () => {
    const qs = [
      { id: "r1", block: "roots" as const },
      { id: "r2", block: "roots" as const },
      { id: "c1", block: "childhood" as const },
      { id: "c2", block: "childhood" as const },
    ];
    expect(localProgress(qs, new Set(["r1", "r2", "c1"]), qs[3]!)).toMatchObject({
      doneBlocks: ["roots"],
      block: { id: "childhood", position: 2, total: 2 },
    });
  });
});
