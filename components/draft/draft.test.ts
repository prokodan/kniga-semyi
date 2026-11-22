// I6: правка черновика — проверка цитаты и PATCH /api/stories/:id/edit в AI_MODE=mock без Supabase.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({})); // в тестах нет сборки Next с условием react-server
import { MemoryInterviewRepo } from "@/lib/interview/repo";
import type { Story } from "@/lib/types";
import translateFixture from "@/fixtures/ai/translate.json";
import { PATCH } from "@/app/api/stories/[id]/edit/route";
import { draftChanged, normalizeForMatch, quoteInText } from "./draft";

const g = globalThis as { __interviewMemoryRepo?: MemoryInterviewRepo };

function addStory(over: Partial<Story> = {}): Story {
  const now = new Date().toISOString();
  const s: Story = {
    id: `story-${Math.random().toString(36).slice(2)}`,
    family_id: "fam-draft",
    storyteller_id: "st-1",
    session_id: null,
    parent_story_id: null,
    question_id: "childhood-01",
    block: "childhood",
    audio_url: null,
    duration_sec: 120,
    transcript: "Я родился в Уштобе в сороковом году.",
    text_ru: "Я родился в 1940 году в Уштобе. Помню всё, как будто это было вчера.",
    title: "Лапша у печки",
    quote: "Помню всё, как будто это было вчера.",
    facts: [],
    text_ko: "옛 번역",
    title_ko: "옛 제목",
    quote_ko: "옛 인용",
    followups: [],
    status: "ready",
    error: null,
    sort_order: null,
    created_at: now,
    updated_at: now,
    ...over,
  };
  g.__interviewMemoryRepo ??= new MemoryInterviewRepo();
  g.__interviewMemoryRepo.stories.set(s.id, s);
  return s;
}

function patch(id: string, body: unknown, token: string | null = "tok") {
  return PATCH(
    new Request(`http://localhost/api/stories/${id}/edit`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...(token ? { "x-family-token": token } : {}) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe("цитата — фраза из текста", () => {
  it("не зависит от регистра, ё/е, кавычек и тире", () => {
    expect(normalizeForMatch("«Ёлка — у ПЕЧКИ!»")).toBe("елка у печки");
    expect(quoteInText("помню всё как будто это было вчера", "Я родился. Помню всё, как будто это было вчера.")).toBe(true);
  });
  it("ловит цитату, которой нет в тексте, и не путает части слов", () => {
    expect(quoteInText("Мы жили в Ташкенте", "Мы жили в Уштобе.")).toBe(false);
    expect(quoteInText("род", "Я родился в Уштобе.")).toBe(false);
  });
  it("пустая цитата — без предупреждения", () => {
    expect(quoteInText("  ", "текст")).toBe(true);
  });
  it("draftChanged сравнивает по обрезанным полям", () => {
    expect(draftChanged({ title: " А ", quote: null, text_ru: "Т" }, { title: "А", quote: "", text_ru: "Т" })).toBe(false);
    expect(draftChanged({ title: "А", quote: null, text_ru: "Т" }, { title: "А", quote: "", text_ru: "Т2" })).toBe(true);
  });
});

describe("PATCH /api/stories/:id/edit", () => {
  it("сохраняет правку и перезапускает только перевод", async () => {
    const s = addStory();
    const body = {
      title: "Лапша у печки в Уштобе",
      quote: "Помню всё, как будто это было вчера.",
      text_ru: "Я родился в 1941 году в Уштобе. Помню всё, как будто это было вчера.",
    };
    const res = await patch(s.id, body);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ changed: true, done: true, quoteWarning: false, status: "ready" });

    const saved = g.__interviewMemoryRepo!.stories.get(s.id)!;
    expect(saved.text_ru).toBe(body.text_ru);
    expect(saved.title).toBe(body.title);
    expect(saved.transcript).toBe(s.transcript); // расшифровку и редактуру не трогали
    expect(saved.text_ko).toBe(translateFixture.text_ko);
    expect(saved.title_ko).toBe(translateFixture.title_ko);
    expect(saved.quote_ko).toBe(translateFixture.quote_ko);
  });

  it("предупреждает, если цитаты нет в тексте, но сохраняет", async () => {
    const s = addStory();
    const res = await patch(s.id, { title: s.title, quote: "Этих слов нет", text_ru: s.text_ru });
    expect(res.status).toBe(200);
    expect((await res.json()).quoteWarning).toBe(true);
    expect(g.__interviewMemoryRepo!.stories.get(s.id)!.quote).toBe("Этих слов нет");
  });

  it("без правок перевод не перезапускается", async () => {
    const s = addStory();
    const res = await patch(s.id, { title: s.title, quote: s.quote, text_ru: ` ${s.text_ru} ` });
    expect((await res.json()).changed).toBe(false);
    expect(g.__interviewMemoryRepo!.stories.get(s.id)!.text_ko).toBe("옛 번역");
  });

  it("пустой текст → 400, без ссылки → 403, нет истории → 404", async () => {
    const s = addStory();
    expect((await patch(s.id, { title: "А", quote: "", text_ru: "   " })).status).toBe(400);
    expect((await patch(s.id, { title: "А", quote: "", text_ru: "Т" }, null)).status).toBe(403);
    expect((await patch("nope", { title: "А", quote: "", text_ru: "Т" })).status).toBe(404);
  });

  it("глава ещё собирается или это уточнение → 409", async () => {
    const editing = addStory({ status: "editing", text_ru: null, title: null, quote: null, text_ko: null });
    expect((await patch(editing.id, { title: "А", quote: "", text_ru: "Т" })).status).toBe(409);
    const followup = addStory({ parent_story_id: "story-main" });
    expect((await patch(followup.id, { title: "А", quote: "", text_ru: "Т" })).status).toBe(409);
  });
});
