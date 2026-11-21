// Заглушка ИИ: бесплатно, мгновенно, предсказуемо. Режим по умолчанию без ключей (AI_MODE=mock).
// Готовые ответы — fixtures/ai/*.json. Логика простая, чтобы экраны и тесты видели все ветки.
import transcribeFixture from "@/fixtures/ai/transcribe.json";
import editFixture from "@/fixtures/ai/edit.json";
import translateFixture from "@/fixtures/ai/translate.json";
import taleFixture from "@/fixtures/ai/tale.json";
import type { AiProvider, AiStep, ProviderCall } from "../types";
import { sha256 } from "../util";

const PALETTE = ["#f2eadc", "#e8d5b5", "#d9c4a0", "#cfe0d6", "#f4d6cc"];

function placeholderSvg(prompt: string): string {
  const h = sha256(prompt);
  const bg = PALETTE[parseInt(h.slice(0, 2), 16) % PALETTE.length];
  const label = prompt.slice(0, 40).replace(/[<&>"]/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="100%" height="100%" fill="${bg}"/><circle cx="512" cy="430" r="180" fill="#b8402f" opacity="0.15"/><text x="512" y="780" font-family="serif" font-size="36" text-anchor="middle" fill="#4a403a">${label}</text></svg>`;
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

export function mockOutput<S extends AiStep>(step: S, input: ProviderCall<S>["input"]): unknown {
  switch (step) {
    case "transcribe":
      return transcribeFixture;
    case "edit":
      return editFixture;
    case "translate":
      return translateFixture;
    case "completeness": {
      const i = input as ProviderCall<"completeness">["input"];
      const short = wordCount(i.answer) < 25;
      const canAsk = i.followupsAsked < i.maxFollowups;
      if (i.answer.trim() === "" || (short && canAsk)) {
        const [first, ...rest] = i.minimum;
        const covered = i.answer.trim() === "" ? [] : [first ?? ""].filter(Boolean);
        const missing = i.answer.trim() === "" ? i.minimum : rest;
        return {
          covered,
          missing,
          followup: "А сколько вам тогда было лет и где это было?",
          done: false,
          offTopicBlock: null,
        };
      }
      return { covered: i.minimum, missing: [], followup: null, done: true, offTopicBlock: null };
    }
    case "next_question": {
      const i = input as ProviderCall<"next_question">["input"];
      const next = i.candidateQuestions.find((q) => !i.coveredBlocks.includes(q.block)) ?? i.candidateQuestions[0]!;
      return { questionId: next.id, bridge: "Спасибо, это очень ценно." };
    }
    case "tale":
      return taleFixture;
    case "illustrate": {
      const i = input as ProviderCall<"illustrate">["input"];
      return { imageBase64: Buffer.from(placeholderSvg(i.prompt)).toString("base64"), mimeType: "image/svg+xml" };
    }
    case "persona_reply": {
      const i = input as ProviderCall<"persona_reply">["input"];
      if (i.behavior === "one-word") return { answer: "Да, было." };
      if (i.behavior === "refuses") return { answer: "Об этом не хочу говорить, давайте дальше." };
      const lines = i.persona
        .split("\n")
        .map((l) => l.replace(/^[-*]\s*/, "").trim())
        .filter((l) => l.length > 40 && !l.startsWith("#"));
      const pick = lines[parseInt(sha256(i.question).slice(0, 4), 16) % Math.max(lines.length, 1)];
      return { answer: pick ?? "Ну, это было давно… Дайте вспомнить." };
    }
    default:
      throw new Error(`mock: неизвестный шаг ${String(step)}`);
  }
}

export const mockProvider: AiProvider = {
  name: "mock",
  isConfigured: () => true,
  supports: () => true,
  async call<S extends AiStep>(req: ProviderCall<S>) {
    return { output: mockOutput(req.step, req.input), usage: {} };
  },
};
