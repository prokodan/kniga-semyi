// #352 (§5.1): прогон банка боевым конвейером — те же промпты, роутер, маршруты и правки без ИИ, что у семьи.
//   • личность → интервью (persona_reply ↔ движок интервью) → edit → translate на язык пары (eval/sim/run.ts —
//     тот же цикл, что у eval: банк вопросов по пакетам, словарь имён, kk / KR-правки конвейера);
//   • текст с нюансами → translate (+ kk-повтор с замечанием и finishKk для ru → kk, fixCyrillic для ru → ko).
// Лимит $ — на весь запуск: перед каждым вызовом ИИ сверяем потраченное (по строкам ai_usage этого процесса).
import type { AiRouter, RunOptions } from "@/lib/ai/router";
import type { AiStore, UsageRow } from "@/lib/ai/store";
import { AiUnavailableError, translateInput, type AiInput, type AiOutput, type AiStep } from "@/lib/ai/types";
import { fixCyrillic } from "@/lib/pipeline/cyrillic";
import { finishKk } from "@/lib/pipeline/kk";
import { translateKk } from "@/lib/pipeline/kk-translate";
import { SimBudgetError } from "@/eval/sim/budget";
import { parsePersona, resolveBehavior } from "@/eval/sim/persona";
import { runSimulation } from "@/eval/sim/run";
import { bookLangsOf, personaMarkdown } from "./core";
import type { NewItem } from "./repo";
import { pairLangs, type QualityPair, type QualityPersona, type QualityText, type RunStatus } from "./types";

/** Шаги, которые проходит прогон, — их маршруты пишем в quality_runs.models.routes */
export const RUN_STEPS: readonly AiStep[] = ["persona_reply", "completeness", "next_question", "edit", "translate"];

/** Упёрлись в лимит $ — для симулятора это та же остановка «по лимиту», что и SimBudgetError. */
export class QualityBudgetError extends SimBudgetError {
  constructor(step: AiStep, readonly usd: number) {
    super(step, 0);
    this.message = `Лимит прогона $${usd.toFixed(2)} исчерпан (шаг ${step} не вызван)`;
    this.name = "QualityBudgetError";
  }
}

/** Обёртка хранилища роутера: считает $ и кто ответил (провайдер/модель) — по строкам ai_usage этого процесса. */
export function trackingStore(inner: AiStore) {
  let cost = 0;
  let calls = 0;
  let used: Record<string, Set<string>> = {};
  const store: AiStore = {
    getRoute: (s) => inner.getRoute(s),
    getProviderSettings: (p) => inner.getProviderSettings(p),
    countCalls: (p, m, since) => inner.countCalls(p, m, since),
    spend: (p, since) => inner.spend(p, since),
    hadFailureSince: (p, m, since, st) => inner.hadFailureSince(p, m, since, st),
    cacheGet: (h) => inner.cacheGet(h),
    cacheSet: (h, s, p, m, o) => inner.cacheSet(h, s, p, m, o),
    async recordUsage(row: UsageRow) {
      cost += Number(row.cost_usd) || 0;
      if (row.status === "ok" || row.status === "cache_hit") {
        calls += 1;
        (used[row.step] ??= new Set()).add(row.status === "cache_hit" ? "cache" : `${row.provider}/${row.model}`);
      }
      return inner.recordUsage(row);
    },
  };
  return {
    store,
    cost: () => cost,
    calls: () => calls,
    used: (): Record<string, string[]> => Object.fromEntries(Object.entries(used).map(([k, v]) => [k, [...v]])),
    /** Начать счёт для следующей строки quality_runs (общая сумма запуска — в cost() не сбрасывается) */
    resetUsed() {
      used = {};
      calls = 0;
    },
  };
}

/** ai.run с лимитом $: перед вызовом сверяем spent() с limitUsd; noCache — не читать ai_cache (свежий ответ). */
export function guardedAi(ai: Pick<AiRouter, "run">, spent: () => number, limitUsd: number, opts: RunOptions = {}): Pick<AiRouter, "run"> {
  return {
    async run<S extends AiStep>(step: S, input: AiInput<S>, o?: RunOptions): Promise<AiOutput<S>> {
      if (spent() >= limitUsd) throw new QualityBudgetError(step, limitUsd);
      return ai.run(step, input, { ...opts, ...o });
    },
  };
}

export interface RunOutcome {
  status: RunStatus;
  items: NewItem[];
  error: string | null;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** Текст с нюансами → перевод на язык пары, как в конвейере (без словаря семьи: у текста его нет). */
export async function runText(text: QualityText, pair: QualityPair, ai: Pick<AiRouter, "run">): Promise<RunOutcome> {
  const { from, to } = pairLangs(pair);
  const focus = text.focus_terms.map((src) => ({ src }));
  const src = { text_ru: text.text_src, title: text.event, quote: "" };
  try {
    let out: { text_ko: string; title_ko: string };
    if (from === "ru" && to === "kk") {
      const t = await translateKk((input) => ai.run("translate", input), src, [], []);
      out = finishKk(t.res.out, text.text_src, []).out;
    } else if (from === "ru" && to === "ko") {
      out = fixCyrillic(await ai.run("translate", src), []).out;
    } else {
      out = await ai.run("translate", translateInput(from, to, src));
    }
    return {
      status: "ok",
      error: null,
      items: [{ position: 0, title: out.title_ko || text.event, src_text: text.text_src, out_text: out.text_ko, lang_from: from, lang_to: to, step: "translate", focus_terms: focus }],
    };
  } catch (e) {
    if (e instanceof QualityBudgetError) return { status: "budget", items: [], error: e.message };
    if (e instanceof AiUnavailableError) return { status: "error", items: [], error: errText(e) };
    throw e;
  }
}

export interface PersonaRunOptions {
  /** Сколько основных вопросов банка задать (по умолчанию 3 — 2–4 главы) */
  maxQuestions?: number;
  /** Вызовов ИИ на одну личность (по умолчанию 30) */
  maxCalls?: number;
}

/** Личность → интервью → главы → перевод на язык пары (eval/sim — тот же цикл, что в eval). */
export async function runPersona(
  persona: QualityPersona,
  pair: QualityPair,
  ai: Pick<AiRouter, "run">,
  opts: PersonaRunOptions = {},
): Promise<RunOutcome> {
  const p = parsePersona(persona.seed_key ?? persona.id, personaMarkdown(persona));
  const langs = bookLangsOf(pair);
  const res = await runSimulation({
    persona: p,
    behavior: resolveBehavior(p),
    maxQuestions: opts.maxQuestions ?? 3,
    maxCalls: opts.maxCalls ?? 30,
    ai,
    bookLangs: langs,
    mode: "quality",
  });
  const [from, to] = langs as [string, string];
  const items: NewItem[] = [];
  for (const ch of res.chapters) {
    const pick =
      to === "ko"
        ? { src: ch.text_ru, out: ch.text_ko, title: ch.title_ko ?? ch.title }
        : to === "kk"
          ? { src: ch.text_ru, out: ch.text_kk, title: ch.title_kk ?? ch.title }
          : { src: ch.text_kk, out: ch.text_ru, title: ch.title };
    if (!pick.src?.trim() || !pick.out?.trim()) continue;
    items.push({ position: items.length, title: pick.title ?? null, src_text: pick.src, out_text: pick.out, lang_from: from, lang_to: to, step: "translate", focus_terms: [] });
  }
  const failed = res.chapters.filter((c) => c.error).length;
  const budgetStop = res.stoppedBy === "budget" && /\$/.test(res.stopDetail ?? "");
  const status: RunStatus = items.length === 0 ? (budgetStop ? "budget" : "error") : failed || res.stoppedBy === "ai_unavailable" || budgetStop ? "partial" : "ok";
  const error = status === "ok" ? null : (res.stopDetail ?? res.chapters.find((c) => c.error)?.error ?? "нет глав").slice(0, 300);
  return { status, items, error };
}
