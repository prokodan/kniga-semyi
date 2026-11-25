// #140: ответ засчитан до расшифровки (#107) → после расшифровки конвейер проверяет полноту; не хватает минимума —
// уточнение откладывается (stories.deferred_followup) и интервью задаёт его в конце раздела или в следующей сессии.
import { describe, expect, it } from "vitest";
import { createRouter } from "@/lib/ai/router";
import { MemoryStore } from "@/lib/ai/store";
import { AiUnavailableError, type AiStep } from "@/lib/ai/types";
import { createQuestionBank, getQuestionBank } from "@/lib/interview/bank";
import { createInterview, type AnswerResult } from "@/lib/interview/engine";
import type { SessionState } from "@/lib/interview/policy";
import { MemoryInterviewRepo, type StoryPatch } from "@/lib/interview/repo";
import { createPipeline } from "./engine";
import { MemoryPipelineRepo } from "./repo";

const full = getQuestionBank();
/** Два раздела: «Корни» (2 вопроса) → «Детство» (1) — чтобы быстро дойти до конца раздела. */
const small = createQuestionBank([full.get("roots-01")!, full.get("roots-02")!, full.inBlock("childhood")[0]!]);

const LONG =
  "Родился я в Уштобе в сорок первом году в семье рисоводов. Отец Ким Сан Ир был бригадиром, мама Пак Ок Сун вела дом и пела нам по вечерам. Помню запах риса на току и как мы с братом бегали к арыку.";

function world(opts: { bank?: ReturnType<typeof createQuestionBank>; fail?: AiStep; failWith?: Error; repo?: MemoryInterviewRepo } = {}) {
  const router = createRouter({ store: new MemoryStore(), mode: () => "mock" });
  const ai = {
    run: ((step, input, o) => {
      if (step === opts.fail) return Promise.reject(opts.failWith ?? new AiUnavailableError(step, []));
      return router.run(step, input, o);
    }) as typeof router.run,
  };
  const irepo = opts.repo ?? new MemoryInterviewRepo();
  irepo.addFamily("fam-1", "tok-1", ["st-1"]);
  const interview = createInterview({ ai, repo: irepo, bank: opts.bank });
  const prepo = new MemoryPipelineRepo(irepo.stories);
  prepo.sessions = irepo.sessions as never;
  const pipeline = createPipeline({ ai, repo: prepo, bank: opts.bank });
  return { interview, irepo, pipeline };
}

/** Запись ответа, которую интервью засчитало без расшифровки (#107), и её поздняя расшифровка + конвейер. */
async function lateAnswer(w: ReturnType<typeof world>, sessionId: string, transcript: string) {
  const rec = await w.irepo.createStory({ family_id: "fam-1", storyteller_id: "st-1", session_id: sessionId, question_id: null, block: null, transcript: null });
  const r = await w.interview.skip(sessionId, "skip", { storyId: rec.id });
  expect(w.irepo.stories.get(rec.id)!.deferred_followup).toMatchObject({ status: "pending" });
  w.irepo.stories.get(rec.id)!.transcript = transcript; // шаг transcribe (в тесте — без аудио)
  const done = await w.pipeline.processStory(rec.id);
  return { rec: w.irepo.stories.get(rec.id)!, r, done };
}

describe("#140: проверка полноты после поздней расшифровки", () => {
  it("короткий ответ → уточнение отложено, глава всё равно собрана", async () => {
    const w = world();
    const s = await w.interview.startSession({ familyId: "fam-1", storytellerId: "st-1" });
    const { rec, done } = await lateAnswer(w, s.sessionId, "Да, помню.");
    expect(done.done).toBe(true);
    expect(rec.text_ru).toBeTruthy();
    expect(rec.deferred_followup).toMatchObject({ status: "ask", question_id: s.question.id });
    expect(rec.deferred_followup!.text!.length).toBeGreaterThan(5);
  });

  it("развёрнутый ответ → уточнять нечего, отметка снята", async () => {
    const w = world();
    const s = await w.interview.startSession({ familyId: "fam-1", storytellerId: "st-1" });
    const { rec, done } = await lateAnswer(w, s.sessionId, `${LONG} ${LONG}`);
    expect(done.done).toBe(true);
    expect(rec.deferred_followup).toBeNull();
  });

  it("конец раздела: сначала отложенное уточнение, ответ дописан в рассказ, потом следующий раздел", async () => {
    const w = world({ bank: small });
    const s = await w.interview.startSession({ familyId: "fam-1", storytellerId: "st-1" });
    expect(s.question.id).toBe("roots-01");
    const { rec, r } = await lateAnswer(w, s.sessionId, "Да, помню.");
    expect(r.type === "nextQuestion" && r.question.id).toBe("roots-02"); // внутри раздела — не перебиваем
    const deferredText = rec.deferred_followup!.text!;

    const end = await w.interview.submitAnswer(s.sessionId, { text: LONG });
    const q = end.type === "blockDone" ? end.nextQuestion : end.type === "nextQuestion" ? end.question : null;
    expect(q?.id).toBe("roots-01");
    expect(q?.ru).toBe(deferredText);
    expect(end.type === "blockDone" || end.type === "nextQuestion" ? end.bridge : "").toContain("вернёмся к вопросу");

    const after: AnswerResult = await w.interview.submitAnswer(s.sessionId, { text: LONG });
    expect(after.type).toBe("nextQuestion");
    if (after.type === "nextQuestion") {
      expect(after.question.block).toBe("childhood");
      expect(after.storyId).toBe(rec.id); // releaseAfterInterview пересоберёт главу с уточнением
    }
    const story = w.irepo.stories.get(rec.id)!;
    expect(story.followups).toEqual([{ question: deferredText, answer: LONG }]);
    expect(story.deferred_followup).toBeNull();
    const rebuilt = await w.pipeline.rebuild(rec.id, "edit");
    expect(rebuilt).toMatchObject({ ran: "edit" });
  });

  it("следующая сессия: #108 — с первого неотвеченного, отложенное уточнение — в конце раздела, один раз", async () => {
    const w = world({ bank: small });
    const s1 = await w.interview.startSession({ familyId: "fam-1", storytellerId: "st-1" });
    const { rec } = await lateAnswer(w, s1.sessionId, "Да, помню."); // сессию бросили после этого

    const s2 = await w.interview.startSession({ familyId: "fam-1", storytellerId: "st-1" });
    expect(s2.question.id).toBe("roots-02"); // старт не трогаем: телефон сам пролистывает отвеченные вопросы
    expect(s2.greeting).toContain("Продолжим");
    const end = await w.interview.submitAnswer(s2.sessionId, { text: LONG });
    const q = end.type === "blockDone" ? end.nextQuestion : end.type === "nextQuestion" ? end.question : null;
    expect(q?.id).toBe("roots-01");
    expect(q?.ru).toBe(rec.deferred_followup!.text);

    const r = await w.interview.submitAnswer(s2.sessionId, { text: LONG });
    expect(r.type === "nextQuestion" && r.question.block).toBe("childhood");
    expect(w.irepo.stories.get(rec.id)!.deferred_followup).toBeNull();

    // уточнение задано — дальше его нет ни в этой, ни в новой сессии
    const s3 = await w.interview.startSession({ familyId: "fam-1", storytellerId: "st-1" });
    const fin = await w.interview.submitAnswer(s3.sessionId, { text: LONG });
    expect(fin.type).toBe("finished");
  });

  it("«пропустить» на отложенном уточнении — больше не спрашиваем, ответ остаётся засчитанным", async () => {
    const w = world({ bank: small });
    const s1 = await w.interview.startSession({ familyId: "fam-1", storytellerId: "st-1" });
    const { rec } = await lateAnswer(w, s1.sessionId, "Да, помню.");
    const asked = await w.interview.submitAnswer(s1.sessionId, { text: LONG }); // конец «Корней» → уточнение
    expect(asked.type === "blockDone" ? asked.nextQuestion?.id : asked.type === "nextQuestion" ? asked.question.id : null).toBe("roots-01");
    const r = await w.interview.skip(s1.sessionId, "skip");
    expect(r.storyId).toBe(rec.id);
    expect(w.irepo.stories.get(rec.id)!.deferred_followup).toBeNull();
    const state = w.irepo.sessions.get(s1.sessionId)!.state as SessionState;
    expect(state.answered_question_ids).toContain(s1.question.id);
    expect(state.skipped_question_ids ?? []).not.toContain(s1.question.id);
  });

  it("ИИ недоступен при проверке — короткий ответ всё равно получает запасное уточнение", async () => {
    const w = world({ fail: "completeness" });
    const s = await w.interview.startSession({ familyId: "fam-1", storytellerId: "st-1" });
    const { rec, done } = await lateAnswer(w, s.sessionId, "Да, помню.");
    expect(done.done).toBe(true);
    expect(rec.deferred_followup).toMatchObject({ status: "ask" });
  });

  it("проверка упала с ошибкой — глава собирается как до #140, без уточнения", async () => {
    const w = world({ fail: "completeness", failWith: new Error("boom") });
    const s = await w.interview.startSession({ familyId: "fam-1", storytellerId: "st-1" });
    const { rec, done } = await lateAnswer(w, s.sessionId, "Да, помню.");
    expect(done.done).toBe(true);
    expect(rec.deferred_followup).toBeNull();
  });

  it("колонки ещё нет (до migrate) — «не ждать» работает как в #107", async () => {
    class NoColumn extends MemoryInterviewRepo {
      override async updateStory(id: string, patch: StoryPatch) {
        if ("deferred_followup" in patch) throw new Error('column "deferred_followup" does not exist');
        return super.updateStory(id, patch);
      }
      override async deferredFollowups(): Promise<never> {
        throw new Error('column "deferred_followup" does not exist');
      }
    }
    const w = world({ repo: new NoColumn() });
    const s = await w.interview.startSession({ familyId: "fam-1", storytellerId: "st-1" });
    const rec = await w.irepo.createStory({ family_id: "fam-1", storyteller_id: "st-1", session_id: s.sessionId, question_id: null, block: null, transcript: null });
    const r = await w.interview.skip(s.sessionId, "skip", { storyId: rec.id });
    expect(r.type === "nextQuestion" || r.type === "blockDone").toBe(true);
    expect(w.irepo.stories.get(rec.id)!.deferred_followup ?? null).toBeNull();
    const s2 = await w.interview.startSession({ familyId: "fam-1", storytellerId: "st-1" });
    expect(s2.question.id).toBe(full.all()[1]!.id);
  });
});
