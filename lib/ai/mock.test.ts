import { describe, expect, it } from "vitest";
import { mockOutput } from "./providers/mock";
import { outputSchemas, AI_STEPS, inputSchemas, type AiStep } from "./types";

const sampleInputs: Record<AiStep, unknown> = {
  transcribe: { audioBase64: "AAAA", mimeType: "audio/webm", durationSec: 30 },
  edit: { transcript: "текст", storytellerName: "Ким", questionText: "Где вы родились?", block: "childhood" },
  translate: { text_ru: "текст", title: "т", quote: "ц" },
  completeness: { questionText: "Где вы родились?", block: "childhood", minimum: ["где", "когда"], answer: "В Уштобе", followupsAsked: 0 },
  next_question: {
    storytellerName: "Ким",
    coveredBlocks: ["roots"],
    recentAnswers: [],
    candidateQuestions: [
      { id: "roots-01", block: "roots", text: "?" },
      { id: "childhood-01", block: "childhood", text: "?" },
    ],
  },
  tale: { storytellerName: "Ким", stories: [{ title: "т", text_ru: "текст" }] },
  illustrate: { prompt: "boy by the canal", style: "watercolor" },
  persona_reply: { persona: "# Ким\n- Родился в 1940 году в Уштобе, в семье рисоводов колхоза.", question: "Где вы родились?", history: [] },
  judge: { storytellerName: "Ким", manner: "Говорит коротко", chapters: [{ id: "s1", transcript: "Ну, значит…", text_ru: "Я родился" }] },
  back_translate: { chapters: [{ id: "s1", text_ru: "Я родился", text_ko: "나는 태어났다" }] },
};

describe("mock provider", () => {
  it.each(AI_STEPS)("шаг %s отдаёт ответ по контракту", (step) => {
    const input = inputSchemas[step].parse(sampleInputs[step]);
    const out = mockOutput(step, input as never);
    expect(outputSchemas[step].safeParse(out).success).toBe(true);
  });

  it("короткий ответ → уточнение, полный → done", () => {
    const short = mockOutput("completeness", inputSchemas.completeness.parse(sampleInputs.completeness)) as { done: boolean; followup: string | null };
    expect(short.done).toBe(false);
    expect(short.followup).toBeTruthy();
    const long = mockOutput(
      "completeness",
      inputSchemas.completeness.parse({ ...(sampleInputs.completeness as object), answer: "слово ".repeat(40) }),
    ) as { done: boolean };
    expect(long.done).toBe(true);
  });

  it("back_translate: нет корейского → флажок major; judge — оценка на каждую главу", () => {
    const bt = mockOutput(
      "back_translate",
      inputSchemas.back_translate.parse({ chapters: [{ id: "a", text_ru: "т", text_ko: "나는" }, { id: "b", text_ru: "т", text_ko: "Я родился" }] }),
    ) as { chapters: { id: string; flags: { severity: string }[] }[] };
    expect(bt.chapters.map((c) => c.flags.length)).toEqual([0, 1]);
    expect(bt.chapters[1]!.flags[0]!.severity).toBe("major");
    const j = mockOutput("judge", inputSchemas.judge.parse(sampleInputs.judge)) as { scores: { id: string }[] };
    expect(j.scores.map((s) => s.id)).toEqual(["s1"]);
  });

  it("next_question выбирает непокрытый блок", () => {
    const out = mockOutput("next_question", inputSchemas.next_question.parse(sampleInputs.next_question)) as { questionId: string };
    expect(out.questionId).toBe("childhood-01");
  });
});
