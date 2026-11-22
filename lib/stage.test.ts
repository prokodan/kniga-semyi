import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { DEMO_FAMILY, DEMO_KIOSK_STORY, DEMO_STORY_SEEDS, DEMO_TALE, followupStoryId } from "@/fixtures/demo/family";
import { isStageMode, preparedResult, withStageFallback, type StageLookup } from "./stage";

const ON = { STAGE_MODE: "1" };
const noDb: StageLookup = async () => null;
const never = <T,>() => new Promise<T>(() => undefined);
const roots = DEMO_STORY_SEEDS[0]!;

describe("режим сцены (I12)", () => {
  it("включается STAGE_MODE=1 / true / on", () => {
    expect(isStageMode({ STAGE_MODE: "1" })).toBe(true);
    expect(isStageMode({ STAGE_MODE: "on" })).toBe(true);
    expect(isStageMode({ STAGE_MODE: "" })).toBe(false);
    expect(isStageMode({})).toBe(false);
  });

  it("без STAGE_MODE — ровно ответ ИИ, ошибка не глушится", async () => {
    await expect(withStageFallback(roots.id, "edit", () => Promise.reject(new Error("429")), { env: {}, lookup: noDb })).rejects.toThrow("429");
  });

  it("ИИ молчит 20 с → готовая глава этой демо-истории и пометка в логе", async () => {
    const log = vi.fn();
    const out = await withStageFallback(roots.id, "edit", never, { env: ON, timeoutMs: 30, lookup: noDb, log });
    expect(out.title).toBe(roots.edit.title);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\[stage\] edit .*нет ответа/));
  });

  it("ИИ упал (неверный ключ) → перевод демо без ожидания", async () => {
    const t0 = Date.now();
    const out = await withStageFallback(roots.id, "translate", () => Promise.reject(new Error("401")), { env: ON, lookup: noDb, log: () => undefined });
    expect(out.text_ko).toBe(roots.translate.text_ko);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("ИИ успел — показываем настоящий ответ", async () => {
    const live = { text_ru: "живой", title: "живой", quote: "", facts: [] };
    const out = await withStageFallback(roots.id, "edit", async () => live, { env: ON, timeoutMs: 1000, lookup: noDb });
    expect(out).toEqual(live);
  });

  it("настоящая семья не получает демо-текст", async () => {
    const lookup: StageLookup = async () => ({ family_id: "11111111-1111-4111-8111-111111111111", question_id: "roots-05", block: "roots", parent_story_id: null });
    expect(await preparedResult("edit", "22222222-2222-4222-8222-222222222222", {}, lookup)).toBeNull();
    await expect(withStageFallback("22222222-2222-4222-8222-222222222222", "edit", () => Promise.reject(new Error("401")), { env: ON, lookup })).rejects.toThrow("401");
  });

  it("новая запись демо-семьи на сцене: тот же вопрос / блок, «Трудные времена» — запас", async () => {
    const lookup = (question_id: string, block: string | null, parent: string | null = null): StageLookup => async () => ({
      family_id: DEMO_FAMILY.id,
      question_id,
      block: block as never,
      parent_story_id: parent,
    });
    const id = "33333333-3333-4333-8333-333333333333";
    expect((await preparedResult("edit", id, {}, lookup("work-01", "work")))?.title).toBe(DEMO_STORY_SEEDS[3]!.edit.title);
    expect((await preparedResult("edit", id, {}, lookup("hardship-01", "hardship")))?.title).toBe("Дом, который построила улица");
    const tr = await preparedResult("transcribe", id, {}, lookup("youth-01", "youth", roots.id));
    expect(tr?.text).toBe(DEMO_STORY_SEEDS[2]!.followups[0]!.answer);
  });

  it("уточнение интервью: первое — из демо, потом ответ принимается", async () => {
    const first = await preparedResult("completeness", roots.id, { followupsAsked: 0, minimum: ["где", "когда"] }, noDb);
    expect(first).toMatchObject({ done: false, followup: roots.followups[0]!.question });
    const second = await preparedResult("completeness", roots.id, { followupsAsked: 1, minimum: ["где"] }, noDb);
    expect(second).toMatchObject({ done: true, followup: null });
  });

  it("расшифровка записи-уточнения и истории киоска", async () => {
    expect((await preparedResult("transcribe", followupStoryId(0, 0), {}, noDb))?.text).toBe(roots.followups[0]!.answer);
    expect((await preparedResult("translate", DEMO_KIOSK_STORY.id, {}, noDb))?.title_ko).toBe(DEMO_KIOSK_STORY.translate.title_ko);
  });

  it("сказка и картинки демо узнаются по входу", async () => {
    const tale = await preparedResult("tale", null, { storytellerName: "Ким Чер Су", stories: [{ title: roots.edit.title, text_ru: "…" }] }, noDb);
    expect(tale?.title).toBe(DEMO_TALE.title);
    expect(await preparedResult("tale", null, { storytellerName: "Пак", stories: [{ title: roots.edit.title, text_ru: "…" }] }, noDb)).toBeNull();
    const img = await preparedResult("illustrate", null, { prompt: DEMO_TALE.pages[1]!.illustrationPrompt, style: "x" }, noDb);
    expect(img?.mimeType).toBe("image/svg+xml");
    expect(Buffer.from(img!.imageBase64, "base64").toString()).toContain("<svg");
  });
});

describe("демо-данные", () => {
  it("5–7 глав с уточнениями, вопросы из банка V0, цитата есть в тексте", async () => {
    const { QUESTIONS } = await import("@/content/questions/bank");
    const ids = new Set(QUESTIONS.map((q) => q.id));
    expect(DEMO_STORY_SEEDS.length).toBeGreaterThanOrEqual(5);
    expect(DEMO_STORY_SEEDS.length).toBeLessThanOrEqual(7);
    for (const s of [...DEMO_STORY_SEEDS, DEMO_KIOSK_STORY]) {
      expect(ids.has(s.question_id), s.question_id).toBe(true);
      expect(s.followups.length).toBeGreaterThan(0);
      expect(s.edit.text_ru).toContain(s.edit.quote);
      expect(s.translate.text_ko).toContain(s.translate.quote_ko);
    }
    expect(DEMO_FAMILY.access_token).toMatch(/^[a-f0-9]{64}$/);
    expect(DEMO_FAMILY.name).toMatch(/пример/);
  });
});
