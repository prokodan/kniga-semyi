// #149: ответ на отложенное (#140) или позднее уточнение не перетирает правку семьи: устоявшуюся главу (старше 30 мин
// или поправленную в черновике) интервью не отпускает на пересборку — ответ только дописан в followups.
// #296: семья ушла со страницы записи на уточнении — глава не ждёт 20 минут (удержание — пока уточнение свежее).
import { describe, expect, it } from "vitest";
import { createRouter } from "@/lib/ai/router";
import { MemoryStore } from "@/lib/ai/store";
import { createPipeline, INTERVIEW_HOLD_MS, LATE_CHILD_REBUILD_MS } from "@/lib/pipeline/engine";
import { FOLLOWUP_IDLE_MS, holdsStory, MemoryPipelineRepo } from "@/lib/pipeline/repo";
import { createQuestionBank, getQuestionBank } from "./bank";
import { SETTLED_CHAPTER_MS, settledChapter } from "./edited";
import { createInterview, type AnswerResult } from "./engine";
import type { SessionState } from "./policy";
import { MemoryInterviewRepo } from "./repo";
import type { Story } from "@/lib/types";

const full = getQuestionBank();
const small = createQuestionBank([full.get("roots-01")!, full.get("roots-02")!, full.inBlock("childhood")[0]!]);
const LONG =
  "Родился я в Уштобе в сорок первом году в семье рисоводов. Отец Ким Сан Ир был бригадиром, мама Пак Ок Сун вела дом и пела нам по вечерам. Помню запах риса на току и как мы с братом бегали к арыку.";

function world() {
  const router = createRouter({ store: new MemoryStore(), mode: () => "mock" });
  const irepo = new MemoryInterviewRepo();
  irepo.addFamily("fam-1", "tok-1", ["st-1"]);
  const clock = { t: Date.now() };
  const interview = createInterview({ ai: router, repo: irepo, bank: small, now: () => clock.t });
  const prepo = new MemoryPipelineRepo(irepo.stories);
  prepo.sessions = irepo.sessions as never;
  const pipeline = createPipeline({ ai: router, repo: prepo, bank: small, now: () => clock.t });
  return { interview, irepo, prepo, pipeline, clock };
}

/** Ответ засчитан без расшифровки (#107) → конвейер собрал главу и отложил уточнение (#140). */
async function deferredChapter(w: ReturnType<typeof world>) {
  const s = await w.interview.startSession({ familyId: "fam-1", storytellerId: "st-1" });
  const rec = await w.irepo.createStory({ family_id: "fam-1", storyteller_id: "st-1", session_id: s.sessionId, question_id: null, block: null, transcript: null });
  await w.interview.skip(s.sessionId, "skip", { storyId: rec.id });
  w.irepo.stories.get(rec.id)!.transcript = "Да, помню.";
  expect((await w.pipeline.processStory(rec.id)).done).toBe(true);
  expect(w.irepo.stories.get(rec.id)!.deferred_followup).toMatchObject({ status: "ask" });
  return { sessionId: s.sessionId, id: rec.id };
}

/** Дойти до отложенного уточнения (конец раздела) и ответить на него. */
async function answerDeferred(w: ReturnType<typeof world>, sessionId: string): Promise<AnswerResult> {
  const end = await w.interview.submitAnswer(sessionId, { text: LONG }); // roots-02 → конец раздела → отложенное
  const q = end.type === "blockDone" ? end.nextQuestion : end.type === "nextQuestion" ? end.question : null;
  expect(q?.id).toBe("roots-01");
  return w.interview.submitAnswer(sessionId, { text: LONG });
}

describe("#149: поздний ответ на уточнение не перетирает главу", () => {
  it("свежая глава без правок — как раньше: отпускаем на пересборку", async () => {
    const w = world();
    const { sessionId, id } = await deferredChapter(w);
    const r = await answerDeferred(w, sessionId);
    expect(r.type).toBe("nextQuestion");
    expect(r.type !== "followup" && r.storyId).toBe(id);
  });

  it("глава старше 30 мин — ответ только в followups, пересборки нет, текст тот же", async () => {
    const w = world();
    const { sessionId, id } = await deferredChapter(w);
    const before = structuredClone(w.irepo.stories.get(id)!);
    w.clock.t = new Date(before.created_at).getTime() + SETTLED_CHAPTER_MS + 60_000;
    const r = await answerDeferred(w, sessionId);
    expect(r.type).toBe("nextQuestion");
    expect(r.type !== "followup" && r.storyId).toBeNull(); // releaseAfterInterview ничего не запустит
    const after = w.irepo.stories.get(id)!;
    expect(after.followups.map((f) => f.answer)).toEqual([LONG]);
    expect(after.deferred_followup).toBeNull();
    expect([after.text_ru, after.title, after.text_ko, after.status]).toEqual([before.text_ru, before.title, before.text_ko, "ready"]);
  });

  it("свежая глава, но семья её поправила — тоже не пересобираем", async () => {
    const w = world();
    const { sessionId, id } = await deferredChapter(w);
    w.irepo.stories.get(id)!.text_ru = "Правка семьи: Уштобе, 1941.";
    w.irepo.edited.add(id);
    const r = await answerDeferred(w, sessionId);
    expect(r.type !== "followup" && r.storyId).toBeNull();
    expect(w.irepo.stories.get(id)!.text_ru).toBe("Правка семьи: Уштобе, 1941.");
  });

  it("ещё не собранная глава отпускается всегда; правило — то же, что у опоздавшей записи (#98)", () => {
    expect(LATE_CHILD_REBUILD_MS).toBe(SETTLED_CHAPTER_MS);
    const t0 = Date.parse("2026-11-28T00:00:00Z");
    const created_at = new Date(t0).toISOString();
    expect(settledChapter({ text_ru: null, created_at }, true, t0 + 2 * SETTLED_CHAPTER_MS)).toBe(false);
    expect(settledChapter({ text_ru: "т", created_at }, false, t0 + SETTLED_CHAPTER_MS - 1)).toBe(false);
    expect(settledChapter({ text_ru: "т", created_at }, false, t0 + SETTLED_CHAPTER_MS + 1)).toBe(true);
    expect(settledChapter({ text_ru: "т", created_at }, true, t0)).toBe(true);
  });

  it("опоздавшая запись-уточнение к поправленной свежей главе — только приклеивается (lateChild)", async () => {
    const router = createRouter({ store: new MemoryStore(), mode: () => "mock" });
    const repo = new MemoryPipelineRepo();
    repo.audio.set("a.webm", { data: Buffer.from("x") });
    const pipeline = createPipeline({ ai: router, repo });
    const at = new Date(Date.now() - 5 * 60_000).toISOString();
    const base: Omit<Story, "id" | "parent_story_id" | "question_id" | "audio_url" | "transcript" | "text_ru" | "text_ko" | "title" | "status"> = { family_id: "fam-1", storyteller_id: "st-1", session_id: null, block: "roots", duration_sec: null, title_ko: null, quote: null, quote_ko: null, facts: [], followups: [], error: null, sort_order: null, created_at: at, updated_at: at };
    repo.add({ ...base, id: "m-1", parent_story_id: null, question_id: "roots-02", audio_url: null, transcript: "Папа был кузнецом.", text_ru: "Правка семьи.", text_ko: "…", title: "Кузня", status: "ready" });
    const later = new Date().toISOString();
    repo.add({ ...base, id: "c-1", parent_story_id: "m-1", question_id: "roots-02", audio_url: "a.webm", transcript: null, text_ru: null, text_ko: null, title: null, status: "uploaded", created_at: later, updated_at: later });
    repo.edited.add("m-1");
    const r = await pipeline.processStory("c-1");
    expect(r.rebuildParent).toBeUndefined();
    const p = (await repo.getStory("m-1"))!;
    expect(p).toMatchObject({ status: "ready", text_ru: "Правка семьи." });
    expect({ child: (await repo.getStory("c-1"))!.status, ids: p.followups.map((f) => f.story_id) }).toEqual({ child: "ready", ids: ["c-1"] });
    expect(p.addition_pending).toBe(true); // #328: плашка «Есть новое дополнение»
  });
});

describe("#296: семья ушла с записи на уточнении — глава не ждёт 20 минут", () => {
  const t0 = Date.parse("2026-11-28T00:00:00Z");
  const iso = (t: number) => new Date(t).toISOString();
  const story = { id: "s-1", question_id: "roots-01", created_at: iso(t0) };
  const onQuestion = (extra: Partial<SessionState> = {}) => ({ state: { current_question_id: "roots-01", ...extra } as unknown as Record<string, unknown> });

  it("держим, пока уточнение свежее; бросили — отпускаем; без отметки — от записи", () => {
    const fresh = onQuestion({ current_story_id: "s-1", followup_at: iso(t0 + 10 * 60_000) });
    expect(holdsStory(fresh, story, t0 + 10 * 60_000 + FOLLOWUP_IDLE_MS - 1)).toBe(true);
    expect(holdsStory(fresh, story, t0 + 10 * 60_000 + FOLLOWUP_IDLE_MS + 1)).toBe(false);
    // ответ ещё не дошёл до интервью (расшифровка, «не ждать» #107) — считаем от записи
    expect(holdsStory(onQuestion(), story, t0 + FOLLOWUP_IDLE_MS - 1)).toBe(true);
    expect(holdsStory(onQuestion(), story, t0 + FOLLOWUP_IDLE_MS + 1)).toBe(false);
    // отметка чужой истории не продлевает удержание этой
    expect(holdsStory(onQuestion({ current_story_id: "s-2", followup_at: iso(t0 + 10 * 60_000) }), story, t0 + FOLLOWUP_IDLE_MS + 1)).toBe(false);
    expect(FOLLOWUP_IDLE_MS).toBeLessThan(INTERVIEW_HOLD_MS);
  });

  it("сквозной: ответ → уточнение → ушли; через 5 мин глава собирается; ответ позже — свежая глава пересоберётся", async () => {
    const w = world();
    const s = await w.interview.startSession({ familyId: "fam-1", storytellerId: "st-1" });
    w.clock.t = Date.now();
    const main = await w.irepo.createStory({ family_id: "fam-1", storyteller_id: "st-1", session_id: s.sessionId, question_id: s.question.id, block: s.question.block, transcript: "Жили в Уштобе." });
    const r1 = await w.interview.submitAnswer(s.sessionId, { storyId: main.id });
    expect(r1.type).toBe("followup");
    expect((w.irepo.sessions.get(s.sessionId)!.state as SessionState).followup_at).toBe(new Date(w.clock.t).toISOString());
    expect(await w.pipeline.runStep(main.id)).toMatchObject({ waiting: "interview" });

    w.clock.t += FOLLOWUP_IDLE_MS + 1_000; // семья закрыла вкладку
    expect((await w.pipeline.processStory(main.id)).done).toBe(true);
    expect(w.irepo.stories.get(main.id)!.text_ru).toBeTruthy();

    // вернулись и ответили — глава свежая и без правок: отпускаем на пересборку с уточнением (как раньше)
    let r: AnswerResult = r1;
    for (let i = 0; i < 3 && r.type === "followup"; i++) r = await w.interview.submitAnswer(s.sessionId, { text: LONG });
    expect(r.type).not.toBe("followup");
    expect(r.type !== "followup" && r.storyId).toBe(main.id);
    expect((w.irepo.sessions.get(s.sessionId)!.state as SessionState).followup_at).toBeUndefined();
  });
});
