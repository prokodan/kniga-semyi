// Контракт ИИ: шаги, входы и выходы. Владелец — Z6 (меняет только Z6, Z2 предлагает в PR).
// Каждый шаг вызывается через роутер: ai.run(step, input). Модели напрямую не вызываем.
import { z } from "zod";
import { LIFE_BLOCKS } from "@/lib/types";

export const AI_STEPS = [
  "transcribe",
  "edit",
  "translate",
  "completeness",
  "next_question",
  "tale",
  "illustrate",
  "persona_reply",
  // Оценка качества (I11, только eval): судья голоса и обратный перевод KR→RU другой моделью.
  "judge",
  "back_translate",
] as const;
export type AiStep = (typeof AI_STEPS)[number];

export const AI_PROVIDERS = ["mock", "gemini", "openai"] as const;
export type AiProviderName = (typeof AI_PROVIDERS)[number];

const lifeBlock = z.enum(LIFE_BLOCKS);
const nullToUndefined = (v: unknown) => (v === null ? undefined : v);
const fact = z.object({
  type: z.enum(["person", "place", "date", "event"]),
  value: z.string(),
  // Модели (Gemini, OpenAI) часто пишут "year": null / "relation": null — это «нет данных», а не ошибка.
  // Без этого 8 из 10 глав kim падали на проверке схемы (V1, PR #38). В выходе null → undefined.
  year: z.preprocess(nullToUndefined, z.number().int().optional()),
  relation: z.preprocess(nullToUndefined, z.string().optional()),
});

/** Схемы входов: роутер валидирует вход до вызова провайдера. */
export const inputSchemas = {
  transcribe: z.object({
    audioBase64: z.string().min(1),
    mimeType: z.string(),
    durationSec: z.number().positive().max(600),
    languageHint: z.enum(["ru", "ko", "mixed"]).default("ru"),
  }),
  edit: z.object({
    transcript: z.string().min(1),
    storytellerName: z.string(),
    questionText: z.string(),
    block: lifeBlock.nullable(),
  }),
  translate: z.object({
    text_ru: z.string().min(1),
    title: z.string(),
    quote: z.string(),
  }),
  completeness: z.object({
    questionText: z.string(),
    block: lifeBlock,
    minimum: z.array(z.string()).min(1),
    answer: z.string(),
    followupsAsked: z.number().int().min(0),
    maxFollowups: z.number().int().min(0).default(3),
  }),
  next_question: z.object({
    storytellerName: z.string(),
    coveredBlocks: z.array(lifeBlock),
    recentAnswers: z.array(z.string()).max(5),
    candidateQuestions: z.array(z.object({ id: z.string(), block: lifeBlock, text: z.string() })).min(1),
  }),
  tale: z.object({
    childName: z.string().optional(),
    storytellerName: z.string(),
    stories: z.array(z.object({ title: z.string(), text_ru: z.string() })).min(1),
  }),
  illustrate: z.object({
    prompt: z.string().min(1),
    style: z.string(),
  }),
  persona_reply: z.object({
    persona: z.string().min(1), // markdown персонажа из eval/personas
    behavior: z.string().optional(), // профиль поведения, напр. "one-word"
    question: z.string(),
    history: z.array(z.object({ q: z.string(), a: z.string() })).max(40),
  }),
  judge: z.object({
    storytellerName: z.string(),
    /** Манера речи рассказчика (из персонажа) — эталон «голоса» */
    manner: z.string(),
    chapters: z
      .array(z.object({ id: z.string(), transcript: z.string().min(1), text_ru: z.string().min(1) }))
      .min(1)
      .max(20),
  }),
  back_translate: z.object({
    chapters: z
      .array(
        z.object({
          id: z.string(),
          text_ru: z.string().min(1), // оригинал главы — для сверки после обратного перевода
          text_ko: z.string().min(1),
          quote_ko: z.string().default(""),
        }),
      )
      .min(1)
      .max(20),
  }),
} satisfies Record<AiStep, z.ZodType>;

/** Схемы выходов: ответ модели проходит проверку, иначе это ошибка провайдера → следующий. */
export const outputSchemas = {
  transcribe: z.object({ text: z.string(), language: z.string().default("ru") }),
  edit: z.object({
    text_ru: z.string().min(1),
    title: z.string().min(1),
    quote: z.string(),
    facts: z.array(fact).default([]),
  }),
  translate: z.object({ text_ko: z.string().min(1), title_ko: z.string(), quote_ko: z.string() }),
  completeness: z.object({
    covered: z.array(z.string()),
    missing: z.array(z.string()),
    followup: z.string().nullable(),
    done: z.boolean(),
    /** если рассказчик ушёл в другую тему — блок, куда засчитать ответ */
    offTopicBlock: lifeBlock.nullable().default(null),
  }),
  next_question: z.object({ questionId: z.string(), bridge: z.string().default("") }),
  tale: z.object({
    title: z.string(),
    pages: z.array(z.object({ text: z.string(), illustrationPrompt: z.string() })).min(1),
  }),
  illustrate: z.object({ imageBase64: z.string(), mimeType: z.string() }),
  persona_reply: z.object({ answer: z.string() }),
  judge: z.object({
    scores: z.array(
      z.object({
        id: z.string(),
        /** 1 — голос потерян (канцелярит / пересказ), 5 — звучит как сам рассказчик */
        voice: z.coerce.number().int().min(1).max(5),
        comment: z.string().default(""),
      }),
    ),
  }),
  back_translate: z.object({
    chapters: z.array(
      z.object({
        id: z.string(),
        back_ru: z.string(),
        /** совпадение смысла с оригиналом: 1 — другой смысл, 5 — полностью совпадает */
        meaning: z.coerce.number().int().min(1).max(5),
        flags: z
          .array(
            z.object({
              ko: z.string(), // сомнительный фрагмент корейского
              back_ru: z.string(), // как он читается обратно
              ru: z.string().default(""), // что было в оригинале
              issue: z.string(),
              severity: z.enum(["minor", "major"]).catch("minor"),
            }),
          )
          .default([]),
      }),
    ),
  }),
} satisfies Record<AiStep, z.ZodType>;

export type AiInput<S extends AiStep> = z.input<(typeof inputSchemas)[S]>;
export type AiParsedInput<S extends AiStep> = z.output<(typeof inputSchemas)[S]>;
export type AiOutput<S extends AiStep> = z.output<(typeof outputSchemas)[S]>;

/** Сколько «стоил» вызов — для ai_usage и бюджета. */
export interface AiUsageMetrics {
  inputTokens?: number;
  outputTokens?: number;
  audioSeconds?: number;
  images?: number;
}

export interface ProviderResult<S extends AiStep = AiStep> {
  output: AiOutput<S>;
  usage: AiUsageMetrics;
}

export interface ProviderCall<S extends AiStep = AiStep> {
  step: S;
  input: AiParsedInput<S>;
  model: string;
  systemPrompt: string;
  signal: AbortSignal;
}

export interface AiProvider {
  name: AiProviderName;
  /** Есть ли ключ / доступен ли провайдер в этом окружении */
  isConfigured(): boolean;
  supports(step: AiStep): boolean;
  call<S extends AiStep>(req: ProviderCall<S>): Promise<{ output: unknown; usage: AiUsageMetrics }>;
}

/** Ошибка провайдера с признаком «перейти к следующему и остудить». */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: "rate_limited" | "timeout" | "unsupported" | "bad_output" | "error",
    readonly provider: AiProviderName,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Все провайдеры шага недоступны: вызывающий ставит историю в очередь или включает режим сцены. */
export class AiUnavailableError extends Error {
  constructor(
    readonly step: AiStep,
    readonly attempts: { provider: string; model: string; reason: string }[],
  ) {
    super(`ИИ недоступен для шага ${step}: ${attempts.map((a) => `${a.provider}/${a.model}: ${a.reason}`).join("; ")}`);
    this.name = "AiUnavailableError";
  }
}
