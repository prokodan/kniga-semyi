import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({})); // в тестах нет сборки Next с условием react-server
import type { Story } from "@/lib/types";
import { getFamilyStore, MemoryFamilyStore } from "@/lib/db/access";
import { BookBusyError, bookPdf, buildBook, getBookView, markBookOutdated } from "./build";
import { DEMO_STORIES } from "./pdf/demo";

async function demoFamily(chapters = DEMO_STORIES.length) {
  const store = getFamilyStore() as MemoryFamilyStore;
  const { family, storyteller } = await store.createFamily({
    name: "Книга семьи Ким",
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
  // неготовая глава и ответ на уточнение — в книгу не попадают
  const any = [...store.stories.values()].find((s) => s.family_id === family.id);
  if (any) {
    store.stories.set(`${family.id}-x1`, { ...any, id: `${family.id}-x1`, status: "editing" });
    store.stories.set(`${family.id}-x2`, { ...any, id: `${family.id}-x2`, parent_story_id: any.id });
  }
  return family;
}

describe("buildBook (память, без Supabase)", () => {
  it("draft → ready, PDF доступен, page_count записан", async () => {
    const family = await demoFamily();
    expect((await getBookView(family.id)).status).toBe("draft");
    expect((await getBookView(family.id)).chapters_ready).toBe(7);

    const r = await buildBook(family.id, { origin: "https://kniga.example" });
    expect(r.status).toBe("ready");
    expect(r.chapters).toBe(7);
    expect(r.page_count).toBeGreaterThanOrEqual(16);

    const view = await getBookView(family.id);
    expect(view).toEqual(expect.objectContaining({ status: "ready", has_pdf: true, page_count: r.page_count, title: "Книга семьи Ким" }));
    const file = await bookPdf(family.id);
    expect(file && "pdf" in file && file.pdf.subarray(0, 5).toString()).toBe("%PDF-");

    // #104: правка словаря имён → книга устарела, PDF остаётся доступен
    expect(view.outdated).toBe(false);
    await markBookOutdated(family.id);
    expect(await getBookView(family.id)).toEqual(expect.objectContaining({ status: "draft", has_pdf: true, outdated: true }));
  });

  it("без готовых глав — failed с понятной ошибкой", async () => {
    const family = await demoFamily(0);
    const r = await buildBook(family.id, { origin: "https://kniga.example" });
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/нет готовых глав/);
    expect((await getBookView(family.id)).status).toBe("failed");
  });

  it("10 глав с длинными текстами укладываются в лимит функции (60 с) с большим запасом", async () => {
    const store = getFamilyStore() as MemoryFamilyStore;
    const family = await demoFamily(10);
    for (const s of store.stories.values()) {
      if (s.family_id !== family.id) continue;
      s.text_ru = Array.from({ length: 6 }, () => s.text_ru).join("\n");
      s.text_ko = Array.from({ length: 6 }, () => s.text_ko).join("\n");
    }
    const r = await buildBook(family.id, { origin: "https://kniga.example" });
    expect(r.status).toBe("ready");
    expect(r.chapters).toBe(10);
    expect(r.ms).toBeLessThan(20_000);
    expect(r.bytes).toBeLessThan(1_500_000);
    console.info(`[book] 10 длинных глав: ${r.page_count} стр., ${Math.round(r.bytes / 1024)} КБ, ${r.ms} мс`);
  }, 60_000);

  it("пока идёт сборка — «занято»; повисшая больше 2 минут — снова можно", async () => {
    const family = await demoFamily(1);
    await buildBook(family.id, { origin: "https://kniga.example" });
    const mem = (globalThis as { __bookMemory?: Map<string, { book: { status: string; updated_at: string } }> }).__bookMemory!;
    const entry = mem.get(family.id)!;
    entry.book.status = "building";
    entry.book.updated_at = new Date().toISOString();
    await expect(buildBook(family.id, { origin: "https://kniga.example" })).rejects.toBeInstanceOf(BookBusyError);
    entry.book.updated_at = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    expect((await getBookView(family.id)).status).toBe("failed");
    expect((await buildBook(family.id, { origin: "https://kniga.example" })).status).toBe("ready");
  });
});
