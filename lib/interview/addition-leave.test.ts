// #320: ответ на уточнение к уже собранной главе — отметка stories.addition_pending для плашки «пересобрать?».
// #321: семья закрыла страницу записи на уточнении — interview.leave: глава собирается сразу, без 5 мин ожидания.
import { describe, expect, it } from "vitest";
import { createRouter } from "@/lib/ai/router";
import { MemoryStore } from "@/lib/ai/store";
import { createPipeline } from "@/lib/pipeline/engine";
import { MemoryPipelineRepo } from "@/lib/pipeline/repo";
import { additionView } from "@/components/chapter/addition";
import { createQuestionBank, getQuestionBank } from "./bank";
import { SETTLED_CHAPTER_MS } from "./edited";
import { createInterview, LEFT_AT, type AnswerResult } from "./engine";
import type { SessionState } from "./policy";
import { MemoryInterviewRepo } from "./repo";

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
  return { interview, irepo, pipeline, clock };
}

/** Ответ → уточнение (короткий ответ в mock); вернуть сессию и основную историю. */
async function onFollowup(w: ReturnType<typeof world>) {
  const s = await w.interview.startSession({ familyId: "fam-1", storytellerId: "st-1" });
  const main = await w.irepo.createStory({ family_id: "fam-1", storyteller_id: "st-1", session_id: s.sessionId, question_id: s.question.id, block: s.question.block, transcript: "Жили в Уштобе." });
  const r = await w.interview.submitAnswer(s.sessionId, { storyId: main.id });
  expect(r.type).toBe("followup");
  return { sessionId: s.sessionId, id: main.id };
}

describe("#321: leave — семья закрыла страницу на уточнении", () => {
  it("глава собирается сразу, а не через 5 мин; повторный leave ничего не меняет", async () => {
    const w = world();
    const { sessionId, id } = await onFollowup(w);
    expect(await w.pipeline.runStep(id)).toMatchObject({ waiting: "interview" });
    expect(await w.interview.leave(sessionId, { token: "tok-1" })).toEqual({ storyId: id });
    const state = w.irepo.sessions.get(sessionId)!.state as SessionState;
    expect(state.followup_at).toBe(LEFT_AT);
    expect(state.pending_followup).toBeTruthy(); // вопрос и уточнение остаются — можно вернуться и ответить
    expect((await w.pipeline.processStory(id)).done).toBe(true);
    expect(w.irepo.stories.get(id)!.text_ru).toBeTruthy();
    expect(await w.interview.leave(sessionId, { token: "tok-1" })).toEqual({ storyId: id });

    // вернулись и ответили — свежая глава отпускается на пересборку с ответом (как в #296)
    let r: AnswerResult | null = null;
    for (let i = 0; i < 3 && (!r || r.type === "followup"); i++) r = await w.interview.submitAnswer(sessionId, { text: LONG });
    expect(r!.type !== "followup" && r!.storyId).toBe(id);
  });

  it("не на уточнении — ничего не делает; чужой токен — forbidden", async () => {
    const w = world();
    const s = await w.interview.startSession({ familyId: "fam-1", storytellerId: "st-1" });
    expect(await w.interview.leave(s.sessionId, { token: "tok-1" })).toEqual({ storyId: null });
    expect((w.irepo.sessions.get(s.sessionId)!.state as SessionState).followup_at).toBeUndefined();
    await expect(w.interview.leave(s.sessionId, { token: "чужой" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(w.interview.leave("нет-такой", { token: "tok-1" })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("#320: addition_pending — дополнение не в тексте главы", () => {
  it("ответ на уточнение к собранной главе → отметка; ещё не собранной — нет", async () => {
    const w = world();
    const { sessionId, id } = await onFollowup(w);
    await w.interview.submitAnswer(sessionId, { text: "Отец работал бригадиром." });
    expect(w.irepo.stories.get(id)!.addition_pending).toBeUndefined(); // глава ещё не собрана — edit возьмёт ответ сам

    const w2 = world();
    const f = await onFollowup(w2);
    await w2.interview.leave(f.sessionId, { token: "tok-1" });
    await w2.pipeline.processStory(f.id); // глава собрана без ответа
    w2.clock.t += SETTLED_CHAPTER_MS + 60_000; // устоялась — интервью её не пересоберёт (#149)
    let r: AnswerResult | null = null;
    for (let i = 0; i < 3 && (!r || r.type === "followup"); i++) r = await w2.interview.submitAnswer(f.sessionId, { text: LONG });
    expect(r!.type !== "followup" && r!.storyId).toBeNull();
    const story = w2.irepo.stories.get(f.id)!;
    expect(story.addition_pending).toBe(true);
    expect(story.followups.at(-1)?.answer).toBe(LONG);

    // плашка: флаг выключен — нет; включён — последний ответ и без предупреждения о правке
    expect(additionView(story, { on: false, edited: false })).toBeNull();
    expect(additionView(story, { on: true, edited: true })).toMatchObject({ answer: LONG, edited: true });
    expect(additionView({ ...story, addition_pending: false }, { on: true, edited: false })).toBeNull();
    expect(additionView({ ...story, status: "editing" }, { on: true, edited: false })).toBeNull();
  });
});
