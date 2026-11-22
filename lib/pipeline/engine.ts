// Конвейер истории: uploaded → transcribing → editing → translating → ready | failed.
// Один вызов runStep = один шаг (укладывается в лимит функции Vercel 60 с). Какой шаг следующий — решают
// сохранённые данные, а не статус: нет transcript → transcribe, нет text_ru → edit, нет text_ko → translate.
// Поэтому перезапуск (в том числе после failed) не пересчитывает уже сохранённое, а ответы моделей
// дополнительно кэшируются роутером (ai_cache) — повтор не стоит денег.
//
// Договорённости I10 (PR #22):
//  - текстовый ответ приходит с готовым transcript → шаг transcribe пропускается;
//  - голосовой ответ на уточнение (parent_story_id) только расшифровывается и сразу ready, главой не становится.
//
// AiUnavailableError → статус остаётся на шаге, ответ { queued: true, retryInMinutes }.
// Здесь нет server-only: движок собирается из зависимостей (тесты, симулятор). Боевая сборка — index.ts.
import { DEFAULT_PROVIDERS } from "@/lib/ai/config";
import type { AiRouter } from "@/lib/ai/router";
import { AiUnavailableError } from "@/lib/ai/types";
import { getQuestionBank, type QuestionBank } from "@/lib/interview/bank";
import type { Story, StoryStatus } from "@/lib/types";
import type { PipelinePatch, PipelineRepo } from "./repo";
import { PIPELINE_STEPS, StepError, type PipelineStep, type StepFn } from "./steps/context";
import { edit } from "./steps/edit";
import { transcribe } from "./steps/transcribe";
import { translate } from "./steps/translate";

export { PIPELINE_STEPS, type PipelineStep } from "./steps/context";

export const STEP_STATUS: Record<PipelineStep, StoryStatus> = {
  transcribe: "transcribing",
  edit: "editing",
  translate: "translating",
};

const STEP_LABEL: Record<PipelineStep, string> = {
  transcribe: "расшифровка",
  edit: "редактура",
  translate: "перевод",
};

/** Что показать на экране ожидания (I1/I3) */
export const STATUS_MESSAGE: Record<StoryStatus, string> = {
  uploaded: "Запись получена, начинаем",
  transcribing: "Слушаем и записываем рассказ…",
  editing: "Бережно собираем главу…",
  translating: "Переводим главу на корейский…",
  ready: "Глава готова",
  failed: "Не получилось собрать главу",
  skipped: "Вопрос пропущен — глава не собирается",
};

const STEP_FNS: Record<PipelineStep, StepFn> = { transcribe, edit, translate };

/** Поля, которые очищаются при пересборке с шага (и всех следующих). */
const STEP_FIELDS: Record<PipelineStep, PipelinePatch> = {
  transcribe: { transcript: null },
  edit: { text_ru: null, title: null, quote: null, facts: [] },
  translate: { text_ko: null, title_ko: null, quote_ko: null },
};

export type PipelineErrorCode = "not_found" | "forbidden" | "bad_request";

export class PipelineError extends Error {
  constructor(
    readonly code: PipelineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PipelineError";
  }
}

export interface StepResult {
  storyId: string;
  /** Шаг уже выполняет другой вызов (аренда step_started_at) — этот ничего не делал */
  running?: boolean;
  status: StoryStatus;
  /** Шаг, выполненный этим вызовом (null — делать было нечего) */
  ran: PipelineStep | null;
  /** Следующий шаг (null — история готова или упала) */
  next: PipelineStep | null;
  done: boolean;
  queued: boolean;
  retryInMinutes?: number;
  error: string | null;
  message: string;
}

/** Следующий нужный шаг по сохранённым данным. */
export function nextStep(story: Pick<Story, "transcript" | "text_ru" | "text_ko" | "parent_story_id">): PipelineStep | null {
  if (!story.transcript?.trim()) return "transcribe";
  if (story.parent_story_id) return null; // ответ на уточнение: только расшифровка
  if (!story.text_ru) return "edit";
  if (!story.text_ko) return "translate";
  return null;
}

export interface PipelineDeps {
  ai: Pick<AiRouter, "run">;
  repo: PipelineRepo;
  bank?: QuestionBank;
  /** Через сколько минут повторить, если ИИ недоступен */
  retryInMinutes?: number;
  now?: () => number;
}

/** Бюджет одного шага на все вызовы ИИ: функция Vercel живёт 60 с, остальное — на чтение аудио и запись. */
export const STEP_BUDGET_MS = 48_000;
/** Аренда шага: пока шаг идёт меньше этого, второй вызов его не дублирует. Больше — функцию убили, можно снова. */
export const STEP_LEASE_MS = 65_000;

export function createPipeline(deps: PipelineDeps) {
  const { ai, repo } = deps;
  const bank = deps.bank ?? getQuestionBank();
  const retryInMinutes = deps.retryInMinutes ?? DEFAULT_PROVIDERS.gemini.cooldown_minutes;
  const now = deps.now ?? Date.now;

  async function load(storyId: string, token?: string): Promise<Story> {
    const story = await repo.getStory(storyId);
    if (!story) throw new PipelineError("not_found", "История не найдена");
    if (token !== undefined && !(await repo.checkFamilyToken(story.family_id, token))) {
      throw new PipelineError("forbidden", "Ссылка семьи не подходит к этой истории");
    }
    return story;
  }

  function result(story: Story, ran: PipelineStep | null, extra: Partial<StepResult> = {}): StepResult {
    const next = story.status === "failed" || story.status === "skipped" ? null : nextStep(story);
    return {
      storyId: story.id,
      status: story.status,
      ran,
      next,
      done: story.status === "ready",
      queued: false,
      error: story.error,
      message: STATUS_MESSAGE[story.status],
      ...extra,
    };
  }

  async function save(story: Story, patch: PipelinePatch): Promise<Story> {
    await repo.updateStory(story.id, patch);
    return { ...story, ...patch } as Story;
  }

  /**
   * Выполнить один шаг: `step` — конкретный (он должен быть следующим по данным), без него — следующий нужный.
   * Ничего не делать → история помечается ready (если ещё не).
   * Шаг уже идёт в другом вызове (аренда < 65 с) → { running: true }, ничего не запускаем — без дублей и лишних трат.
   * `restart` — кнопка «Перезапустить сборку»: снять аренду и обнулить счётчик kick-stuck.
   */
  async function runStep(storyId: string, opts: { step?: PipelineStep; token?: string; restart?: boolean } = {}): Promise<StepResult> {
    let story = await load(storyId, opts.token);
    if (story.status === "skipped") return result(story, null); // ответ-отказ: не глава, ничего не делаем
    const step = nextStep(story);
    if (opts.step && opts.step !== step) {
      if (step === null || PIPELINE_STEPS.indexOf(opts.step) < PIPELINE_STEPS.indexOf(step)) {
        throw new PipelineError("bad_request", `Шаг «${STEP_LABEL[opts.step]}» уже выполнен — для пересборки передайте from`);
      }
      throw new PipelineError("bad_request", `Сначала нужен шаг «${STEP_LABEL[step]}»`);
    }
    if (step === null) {
      if (story.status !== "ready" || story.step_started_at) story = await save(story, { status: "ready", error: null, step_started_at: null });
      return result(story, null);
    }
    const leased = story.step_started_at ? now() - new Date(story.step_started_at).getTime() < STEP_LEASE_MS : false;
    if (leased && !opts.restart) return result(story, null, { running: true, next: step, message: STATUS_MESSAGE[STEP_STATUS[step]] });

    const started = now();
    const lease = new Date(started).toISOString();
    story = await save(story, {
      status: STEP_STATUS[step],
      error: null,
      step_started_at: lease,
      ...(opts.restart ? { kick_attempts: 0 } : {}),
    });
    /** Пока шаг шёл, его перезапустили (пересборка, кнопка) — наш результат устарел, не перетираем. */
    async function superseded(): Promise<Story | null> {
      const fresh = await repo.getStory(storyId);
      // Сравниваем моменты, а не строки: Postgres отдаёт timestamptz как «…+00:00», а мы пишем «…Z».
      const theirs = fresh?.step_started_at ? new Date(fresh.step_started_at).getTime() : null;
      return fresh && (theirs !== started || fresh.status === "skipped") ? fresh : null;
    }
    try {
      const patch = await STEP_FNS[step]({ story, ai, repo, bank, deadline: started + STEP_BUDGET_MS });
      const newer = await superseded();
      if (newer) return result(newer, null, { running: Boolean(newer.step_started_at) });
      const after = { ...story, ...patch } as Story;
      const next = nextStep(after);
      story = await save(story, { ...patch, status: next ? STEP_STATUS[next] : "ready", error: null, step_started_at: null });
      return result(story, step);
    } catch (e) {
      const newer = await superseded();
      if (newer) return result(newer, null, { running: Boolean(newer.step_started_at) });
      if (e instanceof AiUnavailableError) {
        // Работа не теряется: статус остаётся на шаге, повторный вызов (экран главы или kick-stuck) продолжит с него.
        story = await save(story, { step_started_at: null });
        return result(story, step, { queued: true, retryInMinutes, next: step, message: `Глава будет готова примерно через ${retryInMinutes} минут` });
      }
      const reason = e instanceof StepError ? e.message : `Техническая ошибка: ${(e as Error).message}`.slice(0, 500);
      story = await save(story, { status: "failed", error: `Шаг «${STEP_LABEL[step]}»: ${reason}`, step_started_at: null });
      return result(story, step);
    }
  }

  /** Пересобрать с шага `from` (и все следующие): например, после новых ответов на уточнения — from: "edit". */
  async function rebuild(storyId: string, from: PipelineStep, opts: { token?: string } = {}): Promise<StepResult> {
    let story = await load(storyId, opts.token);
    if (from === "transcribe" && !story.audio_url) {
      throw new PipelineError("bad_request", "У текстового ответа нет записи — расшифровывать нечего");
    }
    if (story.parent_story_id && from !== "transcribe") {
      throw new PipelineError("bad_request", "Ответ на уточнение не собирается в главу");
    }
    const patch: PipelinePatch = {};
    for (const s of PIPELINE_STEPS.slice(PIPELINE_STEPS.indexOf(from))) Object.assign(patch, STEP_FIELDS[s]);
    story = await save(story, { ...patch, status: STEP_STATUS[from], error: null });
    // Пересборка важнее идущего шага со старыми данными: аренду не ждём.
    return runStep(story.id, { token: opts.token, restart: true });
  }

  /** Прогнать все шаги подряд (тесты, симулятор, скрипты). В HTTP — по одному шагу на вызов. */
  async function processStory(storyId: string, opts: { token?: string; maxSteps?: number } = {}): Promise<StepResult> {
    let last: StepResult | null = null;
    for (let i = 0; i < (opts.maxSteps ?? PIPELINE_STEPS.length + 1); i++) {
      last = await runStep(storyId, { token: opts.token });
      if (last.done || last.queued || last.running || last.status === "failed" || last.next === null) break;
    }
    return last!;
  }

  /** Статус и результат для экрана ожидания. */
  async function view(storyId: string, opts: { token?: string } = {}) {
    const s = await load(storyId, opts.token);
    return {
      storyId: s.id,
      status: s.status,
      next: s.status === "failed" || s.status === "skipped" ? null : nextStep(s),
      done: s.status === "ready",
      message: STATUS_MESSAGE[s.status],
      error: s.error,
      isFollowup: Boolean(s.parent_story_id),
      parentStoryId: s.parent_story_id,
      questionId: s.question_id,
      block: s.block,
      transcript: s.transcript,
      text_ru: s.text_ru,
      title: s.title,
      quote: s.quote,
      facts: s.facts,
      text_ko: s.text_ko,
      title_ko: s.title_ko,
      quote_ko: s.quote_ko,
      updatedAt: s.updated_at,
    };
  }

  return { runStep, rebuild, processStory, view };
}

export type Pipeline = ReturnType<typeof createPipeline>;
export type StoryView = Awaited<ReturnType<Pipeline["view"]>>;
