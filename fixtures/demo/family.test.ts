// #125: словарь имён демо-семьи согласован с текстами демо-глав — на сцене страница /f/<токен>/names
// показывает только то, что действительно есть в главах, и с тем же корейским написанием.
import { describe, expect, it } from "vitest";
import { entityKey } from "@/lib/pipeline/entities";
import { DEMO_KIOSK_BOOK, DEMO_KIOSK_STORIES } from "@/lib/book/pdf/demo";
import { DEMO_ENTITIES, DEMO_KIOSK_ENTITIES, DEMO_KIOSK_STORY, DEMO_KIOSK_STORY_SEEDS, DEMO_KIOSK_STORYTELLER, DEMO_STORY_SEEDS, type DemoEntitySeed, type DemoStorySeed } from "./family";

// основа слова: «Уштобе» → «уштоб», «Валентина» → «валентин» (падежи: «Валентиной», «Дальнем Востоке»)
const stem = (w: string) => entityKey(w).split(" ").map((p) => (p.length > 4 ? p.slice(0, -2) : p));

function entitiesMatchChapters(entities: DemoEntitySeed[], seeds: DemoStorySeed[]) {
  const byKey = new Map(seeds.map((s) => [s.key, s]));
  it("6–10 записей, имена без повторов", () => {
    expect(entities.length).toBeGreaterThanOrEqual(6);
    expect(entities.length).toBeLessThanOrEqual(10);
    expect(new Set(entities.map((e) => entityKey(e.name_ru))).size).toBe(entities.length);
  });

  for (const e of entities) {
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
}

describe("DEMO_ENTITIES", () => entitiesMatchChapters(DEMO_ENTITIES, DEMO_STORY_SEEDS));
describe("DEMO_KIOSK_ENTITIES", () => entitiesMatchChapters(DEMO_KIOSK_ENTITIES, DEMO_KIOSK_STORY_SEEDS));

// #202: киоск «Ли Нина» — полная книга, как у Ким
describe("демо киоска", () => {
  it("10–15 глав, разделы по карте жизни, вопросы банка без повторов, ID без повторов", () => {
    expect(DEMO_KIOSK_STORY_SEEDS.length).toBeGreaterThanOrEqual(10);
    expect(DEMO_KIOSK_STORY_SEEDS.length).toBeLessThanOrEqual(15);
    expect(new Set(DEMO_KIOSK_STORY_SEEDS.map((s) => s.block)).size).toBe(8);
    expect(new Set(DEMO_KIOSK_STORY_SEEDS.map((s) => s.question_id)).size).toBe(DEMO_KIOSK_STORY_SEEDS.length);
    expect(new Set(DEMO_KIOSK_STORY_SEEDS.map((s) => s.id)).size).toBe(DEMO_KIOSK_STORY_SEEDS.length);
    expect(new Set(DEMO_KIOSK_STORY_SEEDS.map((s) => s.key)).size).toBe(DEMO_KIOSK_STORY_SEEDS.length);
    for (const s of DEMO_KIOSK_STORY_SEEDS) expect(s.question_id.startsWith(`${s.block}-`), s.key).toBe(true);
  });

  it("асянди — прежняя история киоска (ID и ключ не изменились)", () => {
    expect(DEMO_KIOSK_STORY.id).toBe("0de30000-0000-4000-8000-000000001101");
    expect(DEMO_KIOSK_STORY.key).toBe("kiosk");
    expect(DEMO_KIOSK_STORY.edit.title).toBe("Асянди для внучки");
  });

  it("слова корё мар из словаря — в KR тем эквивалентом, что в словаре", () => {
    const byKey = new Map(DEMO_KIOSK_STORY_SEEDS.map((s) => [s.key, s]));
    for (const e of DEMO_KIOSK_ENTITIES.filter((x) => x.kind === "word"))
      for (const k of e.stories) expect(byKey.get(k)!.translate.text_ko, `${e.name_ru} в ${k}`).toContain(e.name_ko);
  });

  it("цитата есть в тексте главы RU и KR, в KR нет кириллицы", () => {
    for (const ch of DEMO_KIOSK_STORIES) {
      expect(ch.text_ru, ch.title!).toContain(ch.quote!.slice(1).replace(/[.!?]$/, "")); // первая буква — может быть строчной
      expect(ch.text_ko, ch.title!).toContain(ch.quote_ko!);
      expect(`${ch.title_ko} ${ch.quote_ko} ${ch.text_ko}`, ch.title!).not.toMatch(/[\u0400-\u04FF]/);
    }
  });

  it("книга — бабушка, рассказчица та же, что в базе", () => {
    expect(DEMO_KIOSK_BOOK.elder).toBe("grandmother");
    expect(DEMO_KIOSK_BOOK.storyteller.name).toBe(DEMO_KIOSK_STORYTELLER.name);
    expect(DEMO_KIOSK_BOOK.storyteller.birth_year).toBe(DEMO_KIOSK_STORYTELLER.birth_year);
  });
});
