// Заглушка ИИ: бесплатно, мгновенно, предсказуемо. Режим по умолчанию без ключей (AI_MODE=mock).
// Готовые ответы — fixtures/ai/*.json. Логика простая, чтобы экраны и тесты видели все ветки.
import transcribeFixture from "@/fixtures/ai/transcribe.json";
import editFixture from "@/fixtures/ai/edit.json";
import translateFixture from "@/fixtures/ai/translate.json";
import translateKkFixture from "@/fixtures/ai/translate.kk.json";
import translateRuFixture from "@/fixtures/ai/translate.ru.json";
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

/** Запись не длиннее — заглушка «слышит» короткий ответ. */
export const SHORT_ANSWER_SEC = 3;
export const SHORT_ANSWER = "Да, помню. Это было в Уштобе.";

const MOCK_FOLLOWUPS = [
  "А сколько вам тогда было лет и где это было?",
  "А кто был рядом с вами в тот день?",
  "А что вы тогда почувствовали?",
];

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

export function mockOutput<S extends AiStep>(step: S, input: ProviderCall<S>["input"]): unknown {
  switch (step) {
    case "transcribe": {
      // Короткая запись (≤ 3 с) — короткий ответ: интервью-агент задаст уточнение (ветку видят e2e-тесты I13).
      const i = input as ProviderCall<"transcribe">["input"];
      return i.durationSec <= SHORT_ANSWER_SEC ? { text: SHORT_ANSWER, language: "ru" } : transcribeFixture;
    }
    case "edit":
      return editFixture;
    case "translate": {
      // #231: перевод на казахский / с казахского — нейтральные ключи text / title / quote (как у translate.kk.md)
      const to = (input as ProviderCall<"translate">["input"]).to;
      return to === "kk" ? translateKkFixture : to === "ru" ? translateRuFixture : translateFixture;
    }
    case "completeness": {
      const i = input as ProviderCall<"completeness">["input"];
      // #105 п. 1: следующий вопрос в том же ответе — как next_question заглушки
      const next = i.next ? { next: mockOutput("next_question", { ...i.next, sameBlock: true } as never) } : {};
      const short = wordCount(i.answer) < 25;
      const canAsk = i.followupsAsked < i.maxFollowups;
      if (i.answer.trim() === "" || (short && canAsk)) {
        const [first, ...rest] = i.minimum;
        const covered = i.answer.trim() === "" ? [] : [first ?? ""].filter(Boolean);
        const missing = i.answer.trim() === "" ? i.minimum : rest;
        return {
          covered,
          missing,
          // Разные уточнения по номеру (#99: повторов нет); первое — то, что ждут e2e.
          followup: MOCK_FOLLOWUPS[Math.min(i.followupsAsked, MOCK_FOLLOWUPS.length - 1)]!,
          done: false,
          offTopicBlock: null,
          ...next,
        };
      }
      return { covered: i.minimum, missing: [], followup: null, done: true, offTopicBlock: null, ...next };
    }
    case "next_question": {
      const i = input as ProviderCall<"next_question">["input"];
      const next = i.candidateQuestions.find((q) => !i.coveredBlocks.includes(q.block)) ?? i.candidateQuestions[0]!;
      return { questionId: next.id, bridge: "Спасибо, это очень ценно.", alreadyAnswered: [] };
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
    case "judge": {
      // Заглушка не умеет судить: ставит нейтральную 3, чтобы отчёт честно не дотягивал до цели ≥ 4.
      const i = input as ProviderCall<"judge">["input"];
      // #256: сверка с правкой носителя — оба перевода «как было» (3 / 3), без потерянных фактов
      const golden = (i.golden?.items ?? []).map((g) => ({ id: g.id, x: 3, y: 3, lost_x: [], lost_y: [], comment: "mock: оценка не показательна" }));
      return { scores: i.chapters.map((c) => ({ id: c.id, voice: 3, comment: "mock: оценка не показательна" })), golden };
    }
    case "back_translate": {
      // Заглушка «переводит обратно» оригиналом; флажок только если корейского текста нет вовсе.
      const i = input as ProviderCall<"back_translate">["input"];
      return {
        chapters: i.chapters.map((c) => {
          const hasHangul = /[\uac00-\ud7a3]/.test(c.text_ko);
          return {
            id: c.id,
            back_ru: c.text_ru,
            meaning: hasHangul ? 5 : 1,
            flags: hasHangul
              ? []
              : [{ ko: c.text_ko.slice(0, 60), back_ru: "", ru: c.text_ru.slice(0, 60), issue: "в корейской версии нет хангыля", severity: "major" }],
          };
        }),
      };
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
