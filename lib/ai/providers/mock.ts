// Заглушка ИИ: бесплатно, мгновенно, предсказуемо. Режим по умолчанию без ключей (AI_MODE=mock).
// Готовые ответы — fixtures/ai/*.json. Логика простая, чтобы экраны и тесты видели все ветки.
import transcribeFixture from "@/fixtures/ai/transcribe.json";
import editFixture from "@/fixtures/ai/edit.json";
import translateFixture from "@/fixtures/ai/translate.json";
import translateKkFixture from "@/fixtures/ai/translate.kk.json";
import translateRuFixture from "@/fixtures/ai/translate.ru.json";
import taleFixture from "@/fixtures/ai/tale.json";
import type { AiOutput, AiProvider, AiStep, ProviderCall } from "../types";
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
    case "quality_generate": {
      // #352: заглушка банка проверок — предсказуемые вымышленные личность / текст (номер — по variant)
      const i = input as ProviderCall<"quality_generate">["input"];
      const n = i.variant + 1;
      const tags = i.nuance_tags.length ? i.nuance_tags : ["kinship"];
      if (i.kind === "persona") {
        const personas = Array.from({ length: i.count }, (_, k) => ({
          name: `Заглушкина Анна ${n}.${k + 1}`,
          bio: "Вымышленная рассказчица для проверки. Родилась в 1948 году в посёлке у реки, работала учительницей, вырастила троих детей, сейчас живёт с дочерью.",
          speech_style: "Говорит неторопливо, повторяет «ну вот», зовёт внуков «мои хорошие».",
          tags,
        }));
        return { personas, texts: [] };
      }
      const who = i.persona?.name ?? "рассказчица";
      const texts = Array.from({ length: i.count }, (_, k) => ({
        event: `Заглушка ${n}.${k + 1}: зима ${1950 + n}`,
        text:
          `Это говорит ${who}. Зимой ${1950 + n} года мой младший брат Коля и старшая сестра Валя ходили со мной в школу за четыре километра. ` +
          "Мама давала нам по куску хлеба, а папа говорил: «Учитесь, дети мои, чтобы жить лучше нас». Внуки мои, запомните это. " +
          "В колхозе тогда работали все, от мала до велика, и мы тоже помогали на току после уроков.",
        nuance_tags: tags,
        focus_terms: ["младший брат", "старшая сестра", "Внуки мои"],
      }));
      return { personas: [], texts };
    }
    case "quality_analyze": {
      // #354: заглушка разбора — одна находка на каждую правку абзаца (промпт: «пишите X, не Y» по первому отличию),
      // на каждое фокус-слово «неверно → как правильно» (глоссарий) и на комментарий при оценке ≤ 2 без правок.
      // Та же находка, что в known (по описанию), — duplicate_of.
      const i = input as ProviderCall<"quality_analyze">["input"];
      const known = new Map(i.known.map((k) => [k.summary, k.id]));
      const findings: AiOutput<"quality_analyze">["findings"] = [];
      const push = (f: Omit<AiOutput<"quality_analyze">["findings"][number], "duplicate_of">) =>
        findings.push({ ...f, duplicate_of: known.get(f.summary) ?? null });
      for (const it of i.items) {
        for (const e of it.edits) {
          const [wrong, right] = firstWordDiff(e.before, e.after);
          push({
            item: it.ref,
            component: "prompt",
            severity: "minor",
            summary: `Носитель исправил «${wrong}» на «${right}»`,
            evidence: [{ before: e.before.slice(0, 600), after: e.after.slice(0, 600), note: "" }],
            fix: { kind: "prompt_rule", rule: `Пишите «${right}», а не «${wrong}» (правка носителя).`, src: "", wrong, right },
          });
        }
        for (const t of it.terms) {
          if (!t.fix.trim()) continue;
          push({
            item: it.ref,
            component: "glossary",
            severity: "major",
            summary: `«${t.term}» → «${t.fix}»${t.hint ? ` (${t.hint})` : ""}`,
            evidence: [{ before: t.term, after: t.fix, note: t.hint }],
            fix: { kind: "glossary", rule: "", src: t.hint.toLowerCase(), wrong: t.term, right: t.fix },
          });
        }
        const low = Object.values(it.ratings).some((v) => v <= 2);
        if (!it.edits.length && low && it.comment.trim())
          push({ item: it.ref, component: "prompt", severity: "major", summary: it.comment.trim().slice(0, 200), evidence: [], fix: { kind: "none", rule: "", src: "", wrong: "", right: "" } });
      }
      return { findings };
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

/** #354: первое различие двух абзацев по словам — «было» и «стало» (для заглушки разбора). */
function firstWordDiff(before: string, after: string): [string, string] {
  const a = before.split(/\s+/).filter(Boolean);
  const b = after.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  const strip = (w: string) => w.replace(/^[«"(]+|[».,!?;:)"]+$/g, "");
  const wrong = strip(a.slice(i, a.length - j).join(" ")).slice(0, 120) || "—";
  const right = strip(b.slice(i, b.length - j).join(" ")).slice(0, 120) || "—";
  return [wrong, right];
}
