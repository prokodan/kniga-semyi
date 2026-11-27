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
import { bankForPacks, getQuestionBank, type QuestionBank } from "@/lib/interview/bank";
import type { BookLang, Story, StoryStatus } from "@/lib/types";
import type { PipelinePatch, PipelineRepo } from "./repo";
import { checkDeferred, needsDeferredCheck } from "./deferred";
import { entitiesFromChapter } from "./entities";
import { pendingTranslations } from "./langs";
import { attachChildren, represented } from "./sources";
import { PIPELINE_STEPS, StepError, StepSkip, type PipelineStep, type PlannedStory, type StepFn } from "./steps/context";
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
  /** Главу собирать рано: интервью ещё на этом вопросе (уточнения). Продолжит ручка интервью. */
  waiting?: "interview";
  status: StoryStatus;
  /** Шаг, выполненный этим вызовом (null — делать было нечего) */
  ran: PipelineStep | null;
  /** Следующий шаг (null — история готова или упала) */
  next: PipelineStep | null;
  done: boolean;
  queued: boolean;
  retryInMinutes?: number;
  /** #98: запись-уточнение пришла после сборки главы — основную пересобираем с edit (её id; дальше её ведёт сервер) */
  rebuildParent?: string;
  error: string | null;
  message: string;
}

/**
 * Следующий нужный шаг по сохранённым данным. #231: `pending_langs` (план перевода по языкам книги) — каких переводов
 * ещё нет; не задан — как до #231 (перевод нужен, пока нет text_ko). Книга «только русский» — перевода нет вовсе.
 */
export function nextStep(
  story: Pick<Story, "transcript" | "text_ru" | "text_ko" | "parent_story_id"> & { pending_langs?: readonly BookLang[] },
): PipelineStep | null {
  if (!story.transcript?.trim()) return "transcribe";
  if (story.parent_story_id) return null; // ответ на уточнение: только расшифровка
  if (!story.text_ru) return "edit";
  if (story.pending_langs ? story.pending_langs.length > 0 : !story.text_ko) return "translate";
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
/**
 * Сколько ждать интервью перед сборкой главы (пункт 4): глава собирается, когда закрыт минимум полноты,
 * исчерпаны 3 уточнения или вопрос отложен. Разговор бросили на середине — через 20 мин собираем как есть.
 */
export const INTERVIEW_HOLD_MS = 20 * 60_000;
/**
 * #98: запись-уточнение расшифровалась, когда глава уже собрана (интервью не дождалось расшифровки и пошло дальше).
 * Свежую главу (≤ 30 мин) пересобираем с её ответом; старше — только приклеиваем ответ к уточнениям: семья могла
 * уже поправить черновик, его не перетираем (ответ войдёт при следующей пересборке).
 */
export const LATE_CHILD_REBUILD_MS = 30 * 60_000;

export function createPipeline(deps: PipelineDeps) {
  const { ai, repo } = deps;
  const base = deps.bank ?? getQuestionBank();
  const retryInMinutes = deps.retryInMinutes ?? DEFAULT_PROVIDERS.gemini.cooldown_minutes;
  const now = deps.now ?? Date.now;

  /**
   * #233: банк вопросов семьи (культурные пакеты, флаг culture_packs) — текст вопроса для edit и вопрос отложенного
   * уточнения. Вопроса нет в банке семьи (пакеты сменили после записи) — ищем в банке V0. Сбой — банк V0, как до #233.
   */
  async function bankOf(story: Story): Promise<QuestionBank> {
    if (deps.bank || !repo.culturePacks) return base;
    try {
      const bank = bankForPacks(await repo.culturePacks(story));
      return bank === base ? base : { ...bank, get: (id: string) => bank.get(id) ?? base.get(id) };
    } catch (e) {
      console.warn(`[pipeline] пакеты семьи ${story.id.slice(0, 8)}:`, (e as Error).message);
      return base;
    }
  }

  async function load(storyId: string, token?: string, withPlan = true): Promise<PlannedStory> {
    const story = await repo.getStory(storyId);
    if (!story) throw new PipelineError("not_found", "История не найдена");
    if (token !== undefined && !(await repo.checkFamilyToken(story.family_id, token))) {
      throw new PipelineError("forbidden", "Ссылка семьи не подходит к этой истории");
    }
    return withPlan ? plan(story) : story;
  }

  /** #231: какие переводы главы ещё нужны (языки книги семьи, флаг lang_kk). Сбой — как до #231 (по text_ko). */
  async function plan(story: Story): Promise<PlannedStory> {
    if (!repo.translationPlan || story.parent_story_id) return story;
    try {
      const { langs, have } = await repo.translationPlan(story);
      return { ...story, pending_langs: pendingTranslations(langs, story, have) };
    } catch (e) {
      console.warn(`[pipeline] языки книги ${story.id.slice(0, 8)}:`, (e as Error).message);
      return story;
    }
  }

  function result(story: PlannedStory, ran: PipelineStep | null, extra: Partial<StepResult> = {}): StepResult {
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

  async function save(story: PlannedStory, patch: PipelinePatch): Promise<PlannedStory> {
    await repo.updateStory(story.id, patch);
    return { ...story, ...patch } as PlannedStory;
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
    // #140: ответ засчитали до расшифровки (#107) — теперь расшифровка есть: проверить полноту отдельным вызовом
    // (свои 48 с), глава следующим. Сбой проверки — как до #140: просто собираем главу.
    if (needsDeferredCheck(story)) {
      let deferred = null;
      try {
        deferred = await checkDeferred(story, { ai, bank: await bankOf(story), deadline: now() + STEP_BUDGET_MS, now });
      } catch (e) {
        console.warn(`[pipeline] полнота ${story.id.slice(0, 8)}:`, (e as Error).message);
      }
      try {
        story = await save(story, { deferred_followup: deferred });
        return result(story, null);
      } catch (e) {
        console.warn(`[pipeline] deferred_followup ${story.id.slice(0, 8)}:`, (e as Error).message);
      }
    }
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
    if (
      step === "edit" &&
      !opts.restart &&
      repo.interviewHold &&
      now() - new Date(story.created_at).getTime() < INTERVIEW_HOLD_MS &&
      (await repo.interviewHold(story))
    ) {
      return result(story, null, { waiting: "interview", next: "edit", message: "Ещё разговариваем об этом — глава соберётся после уточнений" });
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
      const bank = step === "edit" ? await bankOf(story) : base; // банк нужен только edit (текст вопроса)
      const patch = await STEP_FNS[step]({ story, ai, repo, bank, deadline: started + STEP_BUDGET_MS });
      const newer = await superseded();
      if (newer) return result(newer, null, { running: Boolean(newer.step_started_at) });
      if (step === "translate" && story.pending_langs) story = { ...story, pending_langs: [] }; // #231: все переводы плана сделаны
      const after = { ...story, ...patch } as PlannedStory;
      const next = nextStep(after);
      story = await save(story, { ...patch, status: next ? STEP_STATUS[next] : "ready", error: null, step_started_at: null });
      // #102: глава собрана — люди, места и слова корё мар в словарь семьи (подсказки следующим главам).
      // Словарь — помощник: его сбой главу не роняет.
      if (step === "edit" && repo.saveEntities) {
        try {
          await repo.saveEntities(story, entitiesFromChapter(story));
        } catch (e) {
          console.warn(`[pipeline] словарь семьи ${story.id.slice(0, 8)}:`, (e as Error).message);
        }
      }
      // #265: древо семьи — в том же шаге, что словарь (флаг family_tree проверяет repo); сбой главу не роняет
      if (step === "edit" && repo.updateTree) {
        try {
          await repo.updateTree(story);
        } catch (e) {
          console.warn(`[pipeline] древо семьи ${story.id.slice(0, 8)}:`, (e as Error).message);
        }
      }
      const rebuildParent = step === "transcribe" && story.parent_story_id ? await lateChild(story) : null;
      return result(story, step, rebuildParent ? { rebuildParent } : {});
    } catch (e) {
      const newer = await superseded();
      if (newer) return result(newer, null, { running: Boolean(newer.step_started_at) });
      if (e instanceof StepSkip) {
        story = await save(story, { ...e.patch, status: "skipped", error: e.message, step_started_at: null });
        return result(story, step);
      }
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

  /**
   * #98: расшифрована запись-уточнение. Если основная глава уже собрана без неё и интервью её не приклеило —
   * приклеить ответ и (для свежей главы) сбросить главу на edit. Возвращает id основной, если её надо вести дальше.
   */
  async function lateChild(child: Story): Promise<string | null> {
    const parent = await repo.getStory(child.parent_story_id!);
    if (!parent || parent.status === "skipped" || !parent.text_ru) return null; // глава ещё не собрана — edit приклеит сам
    if (represented(parent.followups ?? [], child)) return null;
    if (repo.interviewHold && (await repo.interviewHold(parent))) return null; // интервью ещё на вопросе — приклеит само
    const { followups } = attachChildren(parent.followups ?? [], [child]);
    if (now() - new Date(parent.created_at).getTime() > LATE_CHILD_REBUILD_MS) {
      await repo.updateStory(parent.id, { followups });
      return null;
    }
    const patch: PipelinePatch = { followups, status: STEP_STATUS.edit, error: null, step_started_at: null };
    for (const s of PIPELINE_STEPS.slice(PIPELINE_STEPS.indexOf("edit"))) Object.assign(patch, STEP_FIELDS[s]);
    await repo.updateStory(parent.id, patch);
    return parent.id;
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
    // #231: переводы без колонок (kk) тоже заново — иначе в книге остался бы перевод старого текста
    if (repo.dropTranslations) {
      try {
        await repo.dropTranslations(story);
      } catch (e) {
        console.warn(`[pipeline] старые переводы ${story.id.slice(0, 8)}:`, (e as Error).message);
      }
    }
    // Пересборка важнее идущего шага со старыми данными: аренду не ждём.
    return runStep(story.id, { token: opts.token, restart: true });
  }

  /** Прогнать все шаги подряд (тесты, симулятор, скрипты). В HTTP — по одному шагу на вызов. */
  async function processStory(storyId: string, opts: { token?: string; maxSteps?: number } = {}): Promise<StepResult> {
    let last: StepResult | null = null;
    for (let i = 0; i < (opts.maxSteps ?? PIPELINE_STEPS.length + 2); i++) {
      last = await runStep(storyId, { token: opts.token });
      if (last.done || last.queued || last.running || last.waiting || last.status === "failed" || last.next === null) break;
    }
    return last!;
  }

  /** Статус и результат для экрана ожидания. */
  async function view(storyId: string, opts: { token?: string } = {}) {
    // экран главы опрашивает часто — без плана языков (#231, лишний запрос); готовой главе шаг не нужен
    const s = await load(storyId, opts.token, false);
    return {
      storyId: s.id,
      status: s.status,
      next: s.status === "failed" || s.status === "skipped" || s.status === "ready" ? null : nextStep(s),
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
