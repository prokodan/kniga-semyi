// #125: словарь имён демо-семьи согласован с текстами демо-глав — на сцене страница /f/<токен>/names
// показывает только то, что действительно есть в главах, и с тем же корейским написанием.
import { describe, expect, it } from "vitest";
import { entityKey } from "@/lib/pipeline/entities";
import { DEMO_ENTITIES, DEMO_STORY_SEEDS } from "./family";

const byKey = new Map(DEMO_STORY_SEEDS.map((s) => [s.key, s]));
// основа слова: «Уштобе» → «уштоб», «Валентина» → «валентин» (падежи: «Валентиной», «Дальнем Востоке»)
const stem = (w: string) => entityKey(w).split(" ").map((p) => (p.length > 4 ? p.slice(0, -2) : p));

describe("DEMO_ENTITIES", () => {
  it("6–10 записей, имена без повторов", () => {
    expect(DEMO_ENTITIES.length).toBeGreaterThanOrEqual(6);
    expect(DEMO_ENTITIES.length).toBeLessThanOrEqual(10);
    expect(new Set(DEMO_ENTITIES.map((e) => entityKey(e.name_ru))).size).toBe(DEMO_ENTITIES.length);
  });

  for (const e of DEMO_ENTITIES) {
    it(`${e.name_ru}: есть в своих главах RU и KR`, () => {
      expect(e.stories.length).toBeGreaterThan(0);
      for (const k of e.stories) {
        const s = byKey.get(k);
        expect(s, `нет демо-главы ${k}`).toBeDefined();
        const ru = entityKey(s!.edit.text_ru);
        for (const part of stem(e.name_ru)) expect(ru, `${e.name_ru} в главе ${k}`).toContain(part);
        if (e.kind !== "word") expect(s!.translate.text_ko, `${e.name_ko} в главе ${k}`).toContain(e.name_ko);
      }
    });
  }
});
