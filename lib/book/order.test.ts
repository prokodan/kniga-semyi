import { describe, expect, it } from "vitest";
import { BLOCKS } from "@/content/questions/blocks";
import type { LifeBlock } from "@/lib/types";
import { groupBySection, orderByLife } from "./order";

const st = (id: string, block: LifeBlock | null, created_at: string) => ({ id, block, created_at });

describe("порядок глав по карте жизни", () => {
  const stories = [
    st("legacy", "legacy", "2026-11-20T08:00:00Z"),
    st("work", "work", "2026-11-20T09:00:00Z"),
    st("child-late", "childhood", "2026-11-21T10:00:00Z"),
    st("none", null, "2026-11-19T10:00:00Z"),
    st("roots", "roots", "2026-11-22T10:00:00Z"),
    st("child-early", "childhood", "2026-11-20T10:00:00Z"),
  ];

  it("разделы как в content/questions, внутри — по времени записи, без раздела — в конце", () => {
    expect(orderByLife(stories).map((s) => s.id)).toEqual(["roots", "child-early", "child-late", "work", "legacy", "none"]);
  });

  it("группы с названиями разделов", () => {
    const g = groupBySection(stories);
    expect(g.map((x) => x.ru)).toEqual(["Корни", "Детство", "Работа и дело", "Слова внукам", "Другие рассказы"]);
    expect(g[1]!.items.map((s) => s.id)).toEqual(["child-early", "child-late"]);
    expect(g[0]!.ko).toBe(BLOCKS[0]!.ko);
  });
});
