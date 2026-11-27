// Контракт ИИ: шаги, входы и выходы. Владелец — Z6 (меняет только Z6, Z2 предлагает в PR).
// Каждый шаг вызывается через роутер: ai.run(step, input). Модели напрямую не вызываем.
import { z } from "zod";
import { LIFE_BLOCKS, type BookLang } from "@/lib/types";

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

/** #230: языки текстов главы (= BookLang в lib/types). */
export const BOOK_LANGS = ["ru", "ko", "kk"] as const satisfies readonly BookLang[];
/** Пары перевода, для которых есть промпт (prompts/translate.<to>.md). #231 (L1): ru → kk и kk → ru — за флагом lang_kk. */
export const TRANSLATE_PAIRS: readonly (readonly [BookLang, BookLang])[] = [
  ["ru", "ko"],
  ["ru", "kk"],
  ["kk", "ru"],
];
export const DEFAULT_TRANSLATE_PAIR = { from: "ru", to: "ko" } as const satisfies { from: BookLang; to: BookLang };

export function isTranslatePair(from: BookLang, to: BookLang): boolean {
  return TRANSLATE_PAIRS.some(([f, t]) => f === from && t === to);
}

/**
 * Вход шага translate для пары from → to. Для ru → ko пару не пишем — вход (и ключ кэша) как до v2.
 * Пара без промпта — ошибка: перевод на язык, к которому мы не готовы, не должен молча уйти в корейский промпт.
 */
export function translateInput<T extends Omit<AiInput<"translate">, "from" | "to">>(
  from: BookLang,
  to: BookLang,
  input: T,
): T & { from?: BookLang; to?: BookLang } {
  if (!isTranslatePair(from, to)) throw new Error(`Перевод ${from} → ${to} пока не поддерживается`);
  if (from === DEFAULT_TRANSLATE_PAIR.from && to === DEFAULT_TRANSLATE_PAIR.to) return input;
  return { ...input, from, to };
}

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
    languageHint: z.enum(["ru", "ko", "kk", "mixed"]).default("ru"),
    /** Имена, места и слова корё мар, которые могут прозвучать (карточка семьи, прошлые главы, docs/glossary.md) */
    hints: z.array(z.string().max(80)).max(150).optional(),
    /**
     * #300 (флаг spoken_kk): язык рассказа (storytellers.spoken_langs), только если в нём есть kk → промпт
     * prompts/transcribe.kk.md. Не задан — вход, промпт и ключ кэша как до #300 (ru + корё мар).
     */
    spokenLangs: z.array(z.enum(["ru", "kk", "koryo"])).min(1).optional(),
  }),
  edit: z.object({
    transcript: z.string().min(1),
    storytellerName: z.string(),
    questionText: z.string(),
    block: lifeBlock.nullable(),
    /** Как правильно пишутся имена и места этой семьи (карточка, прошлые главы, docs/glossary.md) */
    hints: z.array(z.string().max(80)).max(150).optional(),
    /** #102: словарь семьи (family_entities) — кто есть кто в прошлых главах: люди, места, слова корё мар */
    entities: z
      .array(z.object({ kind: z.enum(["person", "place", "word"]), name: z.string().max(80), about: z.string().max(120).optional() }))
      .max(80)
      .optional(),
  }),
  translate: z.object({
    /**
     * #230: пара языков перевода. Не задана = ru → ko (как до v2): так ключ ai_cache для ru → ko прежний и готовые
     * переводы не пересчитываются; любая другая пара попадает в ключ кэша сама (входит во вход). Собирать вход — translateInput().
     */
    from: z.enum(BOOK_LANGS).optional(),
    to: z.enum(BOOK_LANGS).optional(),
    /** Текст на языке `from` (поле так называется с L0: сейчас всегда русский оригинал) */
    text_ru: z.string().min(1),
    title: z.string(),
    quote: z.string(),
    /** #102: как семья пишет имена и места по-корейски (family_entities.name_ko) — держать одно написание во всей книге */
    names: z.array(z.object({ ru: z.string().max(80), ko: z.string().max(80) })).max(80).optional(),
  }),
  completeness: z.object({
    /**
     * #105 п. 1 (флаг lang_kk): заодно выбрать следующий вопрос — тот же вход, что у next_question. Задан — промпт
     * prompts/completeness.next.md и в ответе `next`; не задан — вызов как до #105 (тот же промпт и ключ кэша).
     */
    next: z
      .object({
        storytellerName: z.string(),
        coveredBlocks: z.array(lifeBlock),
        recentAnswers: z.array(z.string()).max(5),
        candidateQuestions: z.array(z.object({ id: z.string(), block: lifeBlock, text: z.string() })).min(1),
        knownAnswers: z.array(z.string()).max(30).optional(),
      })
      .optional(),
    questionText: z.string(),
    block: lifeBlock,
    minimum: z.array(z.string()).min(1),
    answer: z.string(),
    followupsAsked: z.number().int().min(0),
    maxFollowups: z.number().int().min(0).default(3),
    /** #99: уточнения, которые уже звучали в этой сессии, — не повторять ни дословно, ни по смыслу */
    askedFollowups: z.array(z.string()).max(30).optional(),
    /** #99: прошлые ответы рассказчика — не спрашивать то, что уже известно */
    earlierAnswers: z.array(z.string()).max(30).optional(),
  }),
  next_question: z.object({
    storytellerName: z.string(),
    coveredBlocks: z.array(lifeBlock),
    recentAnswers: z.array(z.string()).max(5),
    candidateQuestions: z.array(z.object({ id: z.string(), block: lifeBlock, text: z.string() })).min(1),
    /** #99: все кандидаты — из одного раздела; новый раздел — мост делает движок, а не модель */
    sameBlock: z.boolean().optional(),
    /** #99: прошлые ответы рассказчика (до 30, обрезаны) — по ним отметить уже отвеченные кандидаты */
    knownAnswers: z.array(z.string()).max(30).optional(),
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
  judge: z
    .object({
      storytellerName: z.string(),
      /** Манера речи рассказчика (из персонажа) — эталон «голоса» */
      manner: z.string(),
      /** Главы для оценки голоса; пусто — только при `golden` (#256) */
      chapters: z.array(z.object({ id: z.string(), transcript: z.string().min(1), text_ru: z.string().min(1) })).max(20),
      /**
       * #256: сверка с золотым набором носителей — какой перевод ближе по смыслу к правке носителя (промпт
       * eval/judge.golden.md). x / y — два перевода абзаца в случайном порядке (один — тот, что правил носитель,
       * другой — новый). Только eval, ≤ 8 абзацев на пару.
       */
      golden: z
        .object({
          pair: z.string(),
          items: z
            .array(z.object({ id: z.string(), source: z.string().min(1), gold: z.string().min(1), x: z.string().min(1), y: z.string().min(1) }))
            .min(1)
            .max(8),
        })
        .optional(),
    })
    .refine((i) => i.chapters.length > 0 || i.golden !== undefined, "judge: нужны chapters (голос) или golden (#256)"),
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

/** #231: { text, title, quote } (перевод на kk / ru) → { text_ko, title_ko, quote_ko }; ответ с text_ko — как есть. */
export function neutralTranslation(v: unknown): unknown {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const o = v as Record<string, unknown>;
  if ("text_ko" in o || !("text" in o)) return v;
  const { text, title, quote, ...rest } = o;
  return { ...rest, text_ko: text, title_ko: title ?? "", quote_ko: quote ?? "" };
}

/** Схемы выходов: ответ модели проходит проверку, иначе это ошибка провайдера → следующий. */
export const outputSchemas = {
  transcribe: z.object({ text: z.string(), language: z.string().default("ru") }),
  edit: z.object({
    text_ru: z.string().min(1),
    title: z.string().min(1),
    quote: z.string(),
    facts: z.array(fact).default([]),
  }),
  // #231: перевод не на корейский (translate.kk.md, translate.ru.md) отвечает нейтральными ключами text / title / quote —
  // приводим их к text_ko / title_ko / quote_ko (= «текст перевода»; имена полей — с L0, когда перевод был только KR).
  translate: z.preprocess(neutralTranslation, z.object({
    text_ko: z.string().min(1),
    title_ko: z.string(),
    quote_ko: z.string(),
    /**
     * #121: как переводчик написал людей и места главы (ru — как в тексте, ko — как в text_ko); по ним словарь семьи
     * держит одно написание во всей книге. Необязательно; кривой список не роняет перевод (catch → нет списка).
     */
    names: z
      .array(z.object({ ru: z.string().max(80), ko: z.string().max(80) }))
      .max(80)
      .optional()
      .catch(undefined),
  })),
  completeness: z.object({
    covered: z.array(z.string()),
    missing: z.array(z.string()),
    followup: z.string().nullable(),
    done: z.boolean(),
    /** если рассказчик ушёл в другую тему — блок, куда засчитать ответ */
    offTopicBlock: lifeBlock.nullable().default(null),
    /** #105 п. 1: следующий вопрос (только если во входе был `next`) — как ответ next_question. Кривой — нет выбора. */
    next: z
      .object({ questionId: z.string(), bridge: z.string().default(""), alreadyAnswered: z.array(z.string()).optional() })
      .optional()
      .catch(undefined),
  }),
  next_question: z.object({
    questionId: z.string(),
    bridge: z.string().default(""),
    /** #99: кандидаты, на которые рассказчик уже ответил в прошлых рассказах — движок их пропускает */
    alreadyAnswered: z.array(z.string()).optional(),
  }),
  tale: z.object({
    title: z.string(),
    pages: z.array(z.object({ text: z.string(), illustrationPrompt: z.string() })).min(1),
  }),
  illustrate: z.object({ imageBase64: z.string(), mimeType: z.string() }),
  persona_reply: z.object({ answer: z.string() }),
  judge: z.object({
    scores: z
      .array(
        z.object({
          id: z.string(),
          /** 1 — голос потерян (канцелярит / пересказ), 5 — звучит как сам рассказчик */
          voice: z.coerce.number().int().min(1).max(5),
          comment: z.string().default(""),
        }),
      )
      .default([]),
    /** #256: по абзацу золотого набора — смысл x и y относительно правки носителя (1–5) и потерянные факты правки */
    golden: z
      .array(
        z.object({
          id: z.string(),
          x: z.coerce.number().int().min(1).max(5),
          y: z.coerce.number().int().min(1).max(5),
          lost_x: z.array(z.string()).default([]),
          lost_y: z.array(z.string()).default([]),
          comment: z.string().default(""),
        }),
      )
      .optional(),
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
