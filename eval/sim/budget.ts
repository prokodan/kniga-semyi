// Лимит запросов к ИИ на один прогон персонажа. Бесплатная квота Gemini — ~500 запросов в сутки,
// поэтому в реальном режиме один прогон — не больше ~60 вызовов (по умолчанию). Считаем каждый
// вызов ai.run, включая попадания в кэш, — с запасом.
import type { AiRouter, RunOptions } from "@/lib/ai/router";
import type { AiInput, AiOutput, AiStep } from "@/lib/ai/types";

export const DEFAULT_MAX_CALLS = 60;

export class SimBudgetError extends Error {
  constructor(
    readonly step: AiStep,
    readonly limit: number,
  ) {
    super(`Лимит прогона исчерпан: ${limit} запросов к ИИ (шаг ${step} не вызван)`);
    this.name = "SimBudgetError";
  }
}

export interface Budget {
  ai: Pick<AiRouter, "run">;
  limit: number;
  used(): number;
  remaining(): number;
  byStep(): Partial<Record<AiStep, number>>;
}

export function withBudget(inner: Pick<AiRouter, "run">, limit = Number.POSITIVE_INFINITY): Budget {
  let used = 0;
  const byStep: Partial<Record<AiStep, number>> = {};
  return {
    limit,
    used: () => used,
    remaining: () => limit - used,
    byStep: () => ({ ...byStep }),
    ai: {
      async run<S extends AiStep>(step: S, input: AiInput<S>, opts?: RunOptions): Promise<AiOutput<S>> {
        if (used >= limit) throw new SimBudgetError(step, limit);
        used += 1;
        byStep[step] = (byStep[step] ?? 0) + 1;
        return inner.run(step, input, opts);
      },
    },
  };
}
