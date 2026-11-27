// #105 п. 1–2 (флаг lang_kk): полнота и следующий вопрос одним вызовом; короткий первый ответ — уточнение без ИИ.
// Флаг выключен (fewerCalls нет / false) — ровно как до #105: completeness + next_question.
import { describe, expect, it } from "vitest";
import { createRouter } from "@/lib/ai/router";
import { MemoryStore } from "@/lib/ai/store";
import type { AiInput, AiOutput, AiStep } from "@/lib/ai/types";
import { createInterview, type AnswerResult } from "./engine";
import { MemoryInterviewRepo } from "./repo";

type Override = { [S in AiStep]?: (input: AiInput<S>) => AiOutput<S> | Promise<AiOutput<S>> };

function setup(fewer: boolean, override: Override = {}) {
  const router = createRouter({ store: new MemoryStore(), mode: () => "mock" });
  const calls: { step: AiStep; input: unknown }[] = [];
  const ai = {
    async run<S extends AiStep>(step: S, input: AiInput<S>, o?: Parameters<typeof router.run>[2]): Promise<AiOutput<S>> {
      calls.push({ step, input });
      const fn = override[step] as ((i: AiInput<S>) => AiOutput<S>) | undefined;
      return fn ? fn(input) : router.run(step, input, o);
    },
  };
  const repo = new MemoryInterviewRepo();
  repo.addFamily("fam-1", "tok-1", ["st-1"]);
  repo.names.set("st-1", "Ким Ен Хо");
  const interview = createInterview({ ai, repo, fewerCalls: async () => fewer });
  const count = (step: AiStep) => calls.filter((c) => c.step === step).length;
  return { interview, calls, count };
}

const LONG = `Родился я в Уштобе, в сорок первом году, в семье рисоводов. Отец Ким Сан Ир был бригадиром, мама Пак Ок Сун
  вела дом и пела нам по вечерам. Помню запах риса на току и как мы с братом бегали к арыку. `.repeat(2);

describe("#105: меньше вызовов ИИ на ответ (флаг lang_kk)", () => {
  it("полный ответ: один вызов completeness (с next) вместо completeness + next_question", async () => {
    const { interview, calls, count } = setup(true);
    const s = await interview.startSession({ familyId: "fam-1", storytellerId: "st-1", mode: "family", token: "tok-1" });
    const r: AnswerResult = await interview.submitAnswer(s.sessionId, { text: LONG }, { token: "tok-1" });
    expect(r.type === "nextQuestion" || r.type === "blockDone").toBe(true);
    expect(count("completeness")).toBe(1);
    expect(count("next_question")).toBe(0);
    const input = calls.find((c) => c.step === "completeness")!.input as AiInput<"completeness">;
    expect(input.next?.candidateQuestions.map((q) => q.id)).not.toContain(s.question.id);
    if (r.type === "nextQuestion") expect(input.next?.candidateQuestions.map((q) => q.id)).toContain(r.question.id);
  });

  it("флаг выключен — как до #105: completeness без next, потом next_question", async () => {
    const { interview, calls, count } = setup(false);
    const s = await interview.startSession({ familyId: "fam-1", storytellerId: "st-1", mode: "family", token: "tok-1" });
    await interview.submitAnswer(s.sessionId, { text: LONG }, { token: "tok-1" });
    expect(count("completeness")).toBe(1);
    expect(count("next_question")).toBe(1);
    expect(calls.find((c) => c.step === "completeness")!.input).not.toHaveProperty("next");
  });

  it("модель не выбрала следующий вопрос — next_question вызывается, как раньше", async () => {
    const { interview, count } = setup(true, {
      completeness: (i) => ({ covered: i.minimum, missing: [], followup: null, done: true, offTopicBlock: null }),
    });
    const s = await interview.startSession({ familyId: "fam-1", storytellerId: "st-1", mode: "family", token: "tok-1" });
    await interview.submitAnswer(s.sessionId, { text: LONG }, { token: "tok-1" });
    expect(count("completeness")).toBe(1);
    expect(count("next_question")).toBe(1);
  });

  it("короткий первый ответ (< 15 слов) — уточнение по шаблону без вызова ИИ; ответ на уточнение — как обычно", async () => {
    const { interview, count } = setup(true);
    const s = await interview.startSession({ familyId: "fam-1", storytellerId: "st-1", mode: "family", token: "tok-1" });
    const r = await interview.submitAnswer(s.sessionId, { text: "Ну жили и жили." }, { token: "tok-1" });
    expect(r.type).toBe("followup");
    if (r.type === "followup") expect(r.text).toMatch(/^А .+\?$/);
    expect(count("completeness")).toBe(0);
    await interview.submitAnswer(s.sessionId, { text: LONG }, { token: "tok-1" });
    expect(count("completeness")).toBe(1);
  });

  it("короткий ответ без флага — модель, как до #105", async () => {
    const { interview, count } = setup(false);
    const s = await interview.startSession({ familyId: "fam-1", storytellerId: "st-1", mode: "family", token: "tok-1" });
    const r = await interview.submitAnswer(s.sessionId, { text: "Ну жили и жили." }, { token: "tok-1" });
    expect(r.type).toBe("followup");
    expect(count("completeness")).toBe(1);
  });
});
