// Пункт 4: короткий ответ не становится главой до уточнений. Конвейер ждёт, пока интервью на вопросе
// этой истории; глава собирается, когда минимум закрыт / 3 уточнения / «позже» — или через 20 мин.
import { describe, expect, it } from "vitest";
import { createRouter } from "@/lib/ai/router";
import { MemoryStore } from "@/lib/ai/store";
import { createQuestionBank } from "@/lib/interview/bank";
import { createInterview } from "@/lib/interview/engine";
import { decideAfterCompleteness, fallbackFollowup, SHORT_ANSWER_WORDS } from "@/lib/interview/policy";
import { MemoryInterviewRepo } from "@/lib/interview/repo";
import { checkFollowup } from "@/eval/prompt-checks";
import { createPipeline, INTERVIEW_HOLD_MS } from "./engine";
import { holdsStory, MemoryPipelineRepo } from "./repo";

const bank = createQuestionBank();
const roots01 = bank.get("roots-01")!;

function world() {
  const router = createRouter({ store: new MemoryStore(), mode: () => "mock" });
  const irepo = new MemoryInterviewRepo();
  irepo.addFamily("fam-1", "tok-1", ["st-1"]);
  const interview = createInterview({ ai: router, repo: irepo });
  const prepo = new MemoryPipelineRepo(irepo.stories);
  prepo.sessions = irepo.sessions as never;
  const clock = { t: Date.now() };
  const pipeline = createPipeline({ ai: router, repo: prepo, now: () => clock.t });
  return { interview, irepo, prepo, pipeline, clock };
}

describe("полнота до сборки главы", () => {
  it("«Жили в Уштобе.» — даже если модель сказала done, первое уточнение будет", () => {
    const res = { covered: ["где родился"], missing: [], followup: null, done: true, offTopicBlock: null };
    const d = decideAfterCompleteness(res, { question: roots01, bank, state: {}, answeringFollowup: false, answer: "Жили в Уштобе." });
    expect(d.kind).toBe("followup");
    if (d.kind === "followup") expect(d.text).toBe("А примерно в каком году это было?");
  });

  it("развёрнутый ответ и done — не перебиваем; после уточнения короткий ответ уже не держим", () => {
    const res = { covered: roots01.minimum, missing: [], followup: null, done: true, offTopicBlock: null };
    const long = Array(SHORT_ANSWER_WORDS + 1).fill("слово").join(" ");
    expect(decideAfterCompleteness(res, { question: roots01, bank, state: {}, answeringFollowup: false, answer: long }).kind).toBe("accept");
    expect(decideAfterCompleteness(res, { question: roots01, bank, state: { followups_asked: 1 }, answeringFollowup: true, answer: "Да." }).kind).toBe("accept");
  });

  it("запасные уточнения проходят проверки eval (одна фраза, «вы», без «подробнее»)", () => {
    for (const q of bank.all()) expect(checkFollowup(fallbackFollowup(q, []), [])).toEqual([]);
  });

  it("сессия на вопросе истории держит главу; вопрос закрыт / сессия завершена — нет", () => {
    const story = { question_id: "roots-01" };
    expect(holdsStory({ state: { current_question_id: "roots-01" } }, story)).toBe(true);
    expect(holdsStory({ state: { current_question_id: "roots-02" } }, story)).toBe(false);
    expect(holdsStory({ state: { current_question_id: "roots-01", answered_question_ids: ["roots-01"] } }, story)).toBe(false);
    expect(holdsStory({ ended_at: "2026-11-23T00:00:00Z", state: { current_question_id: "roots-01" } }, story)).toBe(false);
  });

  it("сквозной: короткий ответ → расшифровка → глава ждёт; уточнение и ответ → вопрос закрыт → глава с уточнением", async () => {
    const { interview, irepo, pipeline } = world();
    const s = await interview.startSession({ familyId: "fam-1", storytellerId: "st-1" });
    const main = await irepo.createStory({ family_id: "fam-1", storyteller_id: "st-1", session_id: s.sessionId, question_id: s.question.id, block: s.question.block, transcript: "Жили в Уштобе." });

    const held = await pipeline.runStep(main.id);
    expect(held).toMatchObject({ waiting: "interview", ran: null, next: "edit" });

    const r1 = await interview.submitAnswer(s.sessionId, { storyId: main.id });
    expect(r1.type).toBe("followup");
    expect((await pipeline.runStep(main.id)).waiting).toBe("interview");

    // ответы на уточнения, пока агент не перейдёт к следующему вопросу
    let r = r1;
    for (let i = 0; i < 3 && r.type === "followup"; i++) {
      r = await interview.submitAnswer(s.sessionId, { text: "Это было в сорок первом, в семье были отец, мама и трое детей, отец работал бригадиром на рисовом поле." });
    }
    expect(r.type).not.toBe("followup");
    const built = await pipeline.rebuild(main.id, "edit"); // что делает releaseAfterInterview
    expect(built).toMatchObject({ ran: "edit" });
    expect(irepo.stories.get(main.id)!.followups.length).toBeGreaterThan(0);
  });

  it("разговор бросили — через 20 мин глава собирается как есть", async () => {
    const { interview, irepo, pipeline, clock } = world();
    const s = await interview.startSession({ familyId: "fam-1", storytellerId: "st-1" });
    const main = await irepo.createStory({ family_id: "fam-1", storyteller_id: "st-1", session_id: s.sessionId, question_id: s.question.id, block: s.question.block, transcript: "Жили в Уштобе." });
    clock.t = new Date(irepo.stories.get(main.id)!.created_at).getTime() + INTERVIEW_HOLD_MS + 1_000;
    expect(await pipeline.runStep(main.id)).toMatchObject({ ran: "edit" });
  });
});
