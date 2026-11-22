// Пункт 3: «не хочу отвечать / не буду об этом» — пропуск вопроса без главы, тёплая фраза, дальше.
import { describe, expect, it } from "vitest";
import { createRouter } from "@/lib/ai/router";
import { MemoryStore } from "@/lib/ai/store";
import type { AiInput, AiOutput, AiStep } from "@/lib/ai/types";
import { createInterview } from "./engine";
import { detectSignal, type SessionState } from "./policy";
import { MemoryInterviewRepo } from "./repo";

function setup() {
  const router = createRouter({ store: new MemoryStore(), mode: () => "mock" });
  const calls: AiStep[] = [];
  const ai = {
    async run<S extends AiStep>(step: S, input: AiInput<S>, o?: Parameters<typeof router.run>[2]): Promise<AiOutput<S>> {
      calls.push(step);
      return router.run(step, input, o);
    },
  };
  const repo = new MemoryInterviewRepo();
  repo.addFamily("fam-1", "tok-1", ["st-1"]);
  const interview = createInterview({ ai, repo });
  return { interview, repo, calls };
}

async function voice(repo: MemoryInterviewRepo, sessionId: string, transcript: string) {
  return repo.createStory({ family_id: "fam-1", storyteller_id: "st-1", session_id: sessionId, question_id: null, block: null, transcript });
}

describe("отказ отвечать", () => {
  it.each([
    "Не хочу отвечать.",
    "Не буду об этом.",
    "Нет, не хочу.",
    "Про маму не буду говорить.",
    "Про неё не хочу.",
    "Я не хочу на это отвечать, давайте другой.",
    "Пропустите, пожалуйста.",
    "Без комментариев.",
  ])("«%s» — отказ", (t) => expect(detectSignal(t)).toBe("refuses"));

  it.each(["Мама не хотела об этом говорить, но я знаю.", "Мы не хотели уезжать из Уштобе.", "Пропустил я тогда школу."])(
    "«%s» — рассказ, не отказ",
    (t) => expect(detectSignal(t)).toBeNull(),
  );

  it("голосовой отказ на основной вопрос: запись сохранена со status skipped, вопрос пропущен, тёплая фраза", async () => {
    const { interview, repo, calls } = setup();
    const s = await interview.startSession({ familyId: "fam-1", storytellerId: "st-1" });
    const st = await voice(repo, s.sessionId, "Не хочу отвечать про это.");
    const r = await interview.submitAnswer(s.sessionId, { storyId: st.id });
    expect(calls).not.toContain("completeness");
    expect(r.type === "nextQuestion" || r.type === "blockDone").toBe(true);
    if (r.type === "nextQuestion") expect(r.bridge).toMatch(/^Хорошо, не будем об этом — это ваше право/);
    expect(r.storyId).toBeNull();
    const saved = repo.stories.get(st.id)!;
    expect(saved.status).toBe("skipped");
    expect(saved.question_id).toBe(s.question.id);
    expect(repo.sessions.get(s.sessionId)!.state.skipped_question_ids).toContain(s.question.id);
  });

  it("отказ на уточнение: основной ответ засчитан, голос «не буду» — skipped, не уходит в followups", async () => {
    const { interview, repo } = setup();
    const s = await interview.startSession({ familyId: "fam-1", storytellerId: "st-1" });
    const main = await voice(repo, s.sessionId, "Жили в Уштобе.");
    const r1 = await interview.submitAnswer(s.sessionId, { storyId: main.id });
    expect(r1.type).toBe("followup");
    const no = await voice(repo, s.sessionId, "Не буду об этом.");
    const r2 = await interview.submitAnswer(s.sessionId, { storyId: no.id });
    expect(r2.type).not.toBe("followup");
    expect(repo.stories.get(no.id)!.status).toBe("skipped");
    expect(repo.stories.get(main.id)!.followups).toHaveLength(0);
    expect((repo.sessions.get(s.sessionId)!.state as SessionState).answered_question_ids).toContain(s.question.id);
  });

  it("длинный рассказ с отказом в конце — глава есть, уточнений нет", async () => {
    const { interview, repo, calls } = setup();
    const s = await interview.startSession({ familyId: "fam-1", storytellerId: "st-1" });
    const text =
      "Родился я в Уштобе в сорок первом году. Отец был бригадиром у рисоводов, мама вела дом и пела нам по вечерам, а мы с братом бегали к арыку. А про войну не хочу говорить.";
    const r = await interview.submitAnswer(s.sessionId, { text });
    expect(r.type).not.toBe("followup");
    expect(calls).not.toContain("completeness");
    const story = [...repo.stories.values()][0]!;
    expect(story.status).not.toBe("skipped");
    expect((repo.sessions.get(s.sessionId)!.state as SessionState).answered_question_ids).toContain(s.question.id);
  });
});
