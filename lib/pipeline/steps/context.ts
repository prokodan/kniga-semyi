// Общая сигнатура шагов конвейера: (ctx) => патч для stories. Шаг ничего не пишет в базу сам —
// сохраняет движок (lib/pipeline/engine.ts), так шаг легко перезапускать и тестировать.
import type { AiRouter } from "@/lib/ai/router";
import type { QuestionBank } from "@/lib/interview/bank";
import type { BookLang, Story } from "@/lib/types";
import type { PipelinePatch, PipelineRepo } from "../repo";

export const PIPELINE_STEPS = ["transcribe", "edit", "translate"] as const;
export type PipelineStep = (typeof PIPELINE_STEPS)[number];

/**
 * #231: история с планом перевода — каких переводов главы ещё нет (по языкам книги семьи и флагу lang_kk).
 * Не задан (нет translationPlan в хранилище / сбой) — как до #231: перевод нужен, пока нет text_ko.
 */
export type PlannedStory = Story & { pending_langs?: BookLang[] };

export interface StepContext {
  story: PlannedStory;
  ai: Pick<AiRouter, "run">;
  repo: PipelineRepo;
  bank: QuestionBank;
  /** Момент (мс epoch), к которому шаг должен закончить все вызовы ИИ — чтобы уложиться в лимит функции */
  deadline?: number;
}

export type StepFn = (ctx: StepContext) => Promise<PipelinePatch>;

/** Ошибка шага, которую надо показать семье как причину failed (не ошибка ИИ — та уходит в очередь). */
export class StepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StepError";
  }
}

/**
 * #98: главу собирать не нужно (весь ответ — повтор более ранней главы). Движок ставит skipped с причиной;
 * `patch` (например, приклеенные уточнения) сохраняется.
 */
export class StepSkip extends Error {
  constructor(
    message: string,
    readonly patch: PipelinePatch = {},
  ) {
    super(message);
    this.name = "StepSkip";
  }
}
