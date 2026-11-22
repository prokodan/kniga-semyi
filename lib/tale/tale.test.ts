import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({})); // в тестах нет сборки Next с условием react-server
import type { Story } from "@/lib/types";
import { getFamilyStore, MemoryFamilyStore } from "@/lib/db/access";
import { DEMO_STORIES } from "@/lib/book/pdf/demo";
import taleFixture from "@/fixtures/ai/tale.json";
import { createTale, getTaleView, illustratePage, TaleError, writeTale } from "./index";
import { cleanChildName, pickTaleStories, taleInputStories, type TaleStory } from "./pick";
import { TALE_STYLE } from "./types";

async function family(chapters: number) {
  const store = getFamilyStore() as MemoryFamilyStore;
  const { family, storyteller } = await store.createFamily({
    name: "Семья Ким",
    gift_date: null,
    contact: null,
    storyteller: { name: "Ким Чер Су", name_ko: "김철수", birth_year: 1940, birth_place: "Уштобе" },
    photo: null,
  });
  for (let i = 0; i < chapters; i++) {
    const d = DEMO_STORIES[i % DEMO_STORIES.length]!;
    const story: Story = {
      ...d,
      id: crypto.randomUUID(),
      family_id: family.id,
      storyteller_id: storyteller.id,
      session_id: null,
      question_id: null,
      audio_url: null,
      duration_sec: 300,
      transcript: d.text_ru,
      facts: [],
      followups: [],
      error: null,
      updated_at: d.created_at,
    };
    store.stories.set(story.id, story);
  }
  return family.id;
}

const s = (over: Partial<TaleStory>): TaleStory => ({
  id: crypto.randomUUID(),
  block: "childhood",
  status: "ready",
  parent_story_id: null,
  text_ru: "Текст главы",
  title: "Глава",
  sort_order: null,
  created_at: "2026-11-20T10:00:00Z",
  ...over,
});

describe("pickTaleStories", () => {
  it("берёт только готовые главы, без уточнений, не больше 5, разные блоки — первыми", () => {
    const stories = [
      s({ block: "hardship" }),
      s({ block: "childhood", created_at: "2026-11-20T09:00:00Z" }),
      s({ block: "childhood", created_at: "2026-11-20T11:00:00Z" }),
      s({ block: "traditions" }),
      s({ block: "work" }),
      s({ block: "love" }),
      s({ block: "roots", status: "editing" }),
      s({ block: "youth", parent_story_id: "x" }),
      s({ block: "legacy", text_ru: "  " }),
    ];
    const picked = pickTaleStories(stories);
    expect(picked).toHaveLength(5);
    // сначала по одной главе из разных блоков (второе детство не вытесняет их), порядок — как в жизни
    expect(picked.map((p) => p.block)).toEqual(["childhood", "work", "love", "hardship", "traditions"]);
  });

  it("обрезает длинную главу и подставляет заголовок", () => {
    const [one] = taleInputStories([s({ title: null, text_ru: "а".repeat(3000) })]);
    expect(one!.title).toBe("Из жизни");
    expect(one!.text_ru.length).toBeLessThanOrEqual(1801);
  });

  it("чистит имя внука", () => {
    expect(cleanChildName('  <Алиса>"  ')).toBe("Алиса");
    expect(cleanChildName("   ")).toBeNull();
    expect(cleanChildName(42)).toBeNull();
  });
});

describe("сказка в AI_MODE=mock", () => {
  it("без двух готовых глав — понятная ошибка", async () => {
    const id = await family(1);
    await expect(writeTale(id)).rejects.toMatchObject({ code: "not_enough" });
    expect((await getTaleView(id)).status).toBe("none");
  });

  it("текст из fixtures/ai/tale.json и SVG-заглушки на каждую страницу", async () => {
    const id = await family(4);
    const t0 = Date.now();
    const view = await createTale(id, { childName: "Алиса" });
    expect(Date.now() - t0).toBeLessThan(2 * 60 * 1000);
    expect(view.status).toBe("ready");
    expect(view.title).toBe(taleFixture.title);
    expect(view.childName).toBe("Алиса");
    expect(view.pages).toHaveLength(taleFixture.pages.length);
    expect(view.illustrated).toBe(view.pages.length);
    for (const p of view.pages) expect(p.image).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("одна строка стиля на все картинки; повтор не перерисовывает, regenerate — перерисовывает", async () => {
    const id = await family(3);
    await writeTale(id);
    const { ai } = await import("@/lib/ai");
    const spy = vi.spyOn(ai, "run");
    await Promise.all([0, 1, 2, 3].map((i) => illustratePage(id, i)));
    const styles = spy.mock.calls.filter((c) => c[0] === "illustrate").map((c) => (c[1] as { style: string }).style);
    expect(styles).toHaveLength(4);
    expect(new Set(styles)).toEqual(new Set([TALE_STYLE]));

    spy.mockClear();
    await illustratePage(id, 1);
    expect(spy).not.toHaveBeenCalled();
    await illustratePage(id, 1, { regenerate: true });
    expect(spy).toHaveBeenCalledWith("illustrate", expect.anything(), { noCache: true });
    spy.mockRestore();
  });

  it("нет страницы — bad_page; повторный write не пишет заново без again", async () => {
    const id = await family(2);
    const first = await writeTale(id);
    await expect(illustratePage(id, 9)).rejects.toBeInstanceOf(TaleError);
    const again = await writeTale(id);
    expect(again.updatedAt).toBe(first.updatedAt);
    const fresh = await writeTale(id, { again: true });
    expect(fresh.status).toBe("ready");
    expect(fresh.illustrated).toBe(0);
  });
});
