import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({})); // в тестах нет сборки Next с условием react-server
import type { Story } from "@/lib/types";
import { getFamilyStore, MemoryFamilyStore } from "@/lib/db/access";
import { DEMO_STORIES } from "@/lib/book/pdf/demo";
import taleFixture from "@/fixtures/ai/tale.json";
import { createTale, getTaleView, illustratePage, TaleError, writeTale } from "./index";
import { knownWords, neutralizeChildName } from "./address";
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

describe("художник и сказочник недоступны — без пустых мест", () => {
  it("illustrate упал → картинка из набора в том же стиле, с пометкой; regenerate не стирает прежнюю", async () => {
    const id = await family(3);
    await writeTale(id);
    const { ai, AiUnavailableError } = await import("@/lib/ai");
    const spy = vi.spyOn(ai, "run").mockRejectedValue(new AiUnavailableError("illustrate", [{ provider: "openai", model: "gpt-image-1", reason: "timeout" }]));
    try {
      const r = await illustratePage(id, 0);
      expect(r.fallback).toBe(true);
      expect(r.notice).toMatch(/Художник сейчас занят/);
      expect(r.image).toMatch(/^data:image\/svg\+xml;base64,/);
      const view = await getTaleView(id);
      expect(view.pages[0]).toMatchObject({ fallback: true });
      expect(view.illustrated).toBe(1);

      const again = await illustratePage(id, 0, { regenerate: true });
      expect(again.image).toBe(r.image);
      expect(again.notice).toMatch(/оставили прежнюю/);
    } finally {
      spy.mockRestore();
    }
    // Художник вернулся — «Нарисовать свою» заменяет картинку из набора
    const drawn = await illustratePage(id, 0, { regenerate: true });
    expect(drawn.fallback).toBe(false);
    expect((await getTaleView(id)).pages[0]).toMatchObject({ fallback: false });
  });

  it("fallback: true (браузер не дождался ответа) — сразу из набора, ИИ не зовём", async () => {
    const id = await family(2);
    await writeTale(id);
    const { ai } = await import("@/lib/ai");
    const spy = vi.spyOn(ai, "run");
    const r = await illustratePage(id, 2, { fallback: true });
    expect(r.fallback).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("«Написать заново» не вышло — прежняя сказка и её картинки остаются, ошибка понятная", async () => {
    const id = await family(3);
    const first = await createTale(id);
    const { ai, AiUnavailableError } = await import("@/lib/ai");
    const spy = vi.spyOn(ai, "run").mockRejectedValue(new AiUnavailableError("tale", []));
    try {
      await expect(writeTale(id, { again: true })).rejects.toMatchObject({ code: "unavailable", message: expect.stringMatching(/Попробовать ещё раз/) });
    } finally {
      spy.mockRestore();
    }
    const view = await getTaleView(id);
    expect(view.status).toBe("ready");
    expect(view.title).toBe(first.title);
    expect(view.illustrated).toBe(first.pages.length);
  });

  it("первая сказка не вышла — статус failed и сообщение с «Попробовать ещё раз»", async () => {
    const id = await family(2);
    const { ai, AiUnavailableError } = await import("@/lib/ai");
    const spy = vi.spyOn(ai, "run").mockRejectedValue(new AiUnavailableError("tale", []));
    try {
      await expect(writeTale(id)).rejects.toBeInstanceOf(TaleError);
    } finally {
      spy.mockRestore();
    }
    const view = await getTaleView(id);
    expect(view.status).toBe("failed");
    expect(view.error).toMatch(/Сказочник сейчас занят/);
  });
});

describe("сказка без имени внука (#44)", () => {
  const known = knownWords("Ким Чер Су", "Я родился в Уштобе. Мама, омани, варила кукси. Брат Коля ловил рыбу.");

  it("выдуманное обращение по имени → «дружок»", () => {
    expect(neutralizeChildName("Знаешь, Алиса, теперь этот мальчик — твой дедушка.", known, { vocative: true })).toBe(
      "Знаешь, дружок, теперь этот мальчик — твой дедушка.",
    );
    expect(neutralizeChildName("Алиса, послушай: это твой дедушка!", known, { vocative: true })).toBe("Дружок, послушай: это твой дедушка!");
    expect(neutralizeChildName("Дорогая Соня, дедушка помнит всё.", known)).toBe("Дружок, дедушка помнит всё.");
    expect(neutralizeChildName("Его внучка Маша любит эту сказку.", known)).toBe("Его внучка любит эту сказку.");
    expect(neutralizeChildName("Сказка для Алисы", known)).toBe("Сказка для тебя");
    expect(neutralizeChildName("Кукси для Коли", known)).toBe("Кукси для Коли");
  });

  it("имена и места из глав, служебные слова и голые запятые на средних страницах не трогает", () => {
    const keep = [
      "Знаешь, это твой дедушка.",
      "Тогда, в Уштобе, брат Коля ловил рыбу.",
      "Летом, Коля, Чер Су и мама шли к реке.",
      "Давным-давно, в тёплом городке Уштобе, жил мальчик.",
    ];
    for (const t of keep) expect(neutralizeChildName(t, known, { vocative: true })).toBe(t);
    // На средней странице между запятыми бывает и не имя ребёнка — без vocative не трогаем
    expect(neutralizeChildName("Летом, Тимур, они шли к реке.", known)).toBe("Летом, Тимур, они шли к реке.");
  });

  it("writeTale без childName подставляет нейтральное обращение, с childName — оставляет имя", async () => {
    const { ai } = await import("@/lib/ai");
    const invented = {
      title: "Сказка для Алисы",
      pages: [
        ...taleFixture.pages.slice(0, 3),
        { text: "Знаешь, Алиса, теперь этот мальчик — твой дедушка.", illustrationPrompt: "grandfather and grandchild, watercolor" },
      ],
    };
    const spy = vi.spyOn(ai, "run").mockImplementation((async () => invented) as never);
    try {
      const neutral = await writeTale(await family(3));
      expect(neutral.childName).toBeNull();
      expect(neutral.title).toBe("Сказка для тебя");
      expect(neutral.pages.at(-1)!.text).toBe("Знаешь, дружок, теперь этот мальчик — твой дедушка.");
      expect(neutral.pages.map((p) => p.text).join(" ")).not.toMatch(/Алис/);

      const named = await writeTale(await family(3), { childName: "Алиса" });
      expect(named.pages.at(-1)!.text).toBe("Знаешь, Алиса, теперь этот мальчик — твой дедушка.");
    } finally {
      spy.mockRestore();
    }
  });
});
