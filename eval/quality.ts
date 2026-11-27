// Оценка качества по симулятору (I11): прогон персонажа (I15) → метрики → отчёт и комментарий в PR.
//   • факты: потерянные / искажённые против «Ключевых фактов» (eval/sim/facts — без ИИ);
//   • уточнения: среднее на вопрос;
//   • голос: LLM-судья ai.run("judge") 1–5 по каждой главе (промпт eval/judge.md), цель MLP — среднее ≥ 4;
//   • корейский: обратный перевод ai.run("back_translate") KR→RU ДРУГОЙ моделью, чем translate,
//     с флажками сомнительных мест (промпт eval/back_translate.md);
//   • корейский без ИИ (eval/kr-check, #103): пояснения в скобках, которых нет в оригинале; отклонение от
//     глоссария (нет эквивалента / вариант «не:»); смешение 해요체 и 한다체 в абзаце;
//   • время шага: среднее время ai.run по каждому шагу;
//   • уточнения, связки и сказка — эвристики без ИИ (eval/prompt-checks), сказка — один вызов ai.run("tale").
// ИИ — только через роутер. В mock всё работает бесплатно и честно помечается «не показательна».
import type { AiRouter, RunOptions } from "@/lib/ai/router";
import { AiUnavailableError, type AiInput, type AiOutput, type AiStep } from "@/lib/ai/types";
import { checkItem, nameSpellingFlags, type GlossaryEntry } from "./kr-check";
import { backTranslateKk, checkKk, KK_NOTE, kkFlagRows, kkTotals, type KkFlag, type KkItem } from "./kk-check";
import { checkDialogue, checkTale, pickTaleChapters, type DialogueChecks, type TaleChecks, type TextIssue } from "./prompt-checks";
import { SimBudgetError } from "./sim/budget";
import { checkFacts, tally, type FactStatus } from "./sim/facts";
import type { Persona } from "./sim/persona";
import type { SimResult } from "./sim/run";

export const VOICE_TARGET = 4;
/** Вызовов ИИ после симуляции на один прогон: judge + back_translate (главы идут одним пакетом) + tale. */
export const QUALITY_CALLS = 3;
/** Сказку пишем, если готовых глав не меньше (как TALE_MIN_STORIES в lib/tale). */
const TALE_MIN_CHAPTERS = 2;
const BATCH_MAX = 20; // контракт judge / back_translate

// ---------------- замер шагов ----------------

export interface StepStat {
  calls: number;
  cached: number;
  totalMs: number;
  models: string[];
}

export interface Instrumented {
  ai: Pick<AiRouter, "run">;
  steps(): Partial<Record<AiStep, StepStat>>;
  /** Модели, которые реально ответили на шаг (без кэша) */
  models(step: AiStep): string[];
}

export interface InstrumentOptions {
  clock?: () => number;
  /** Пауза между настоящими (не из кэша) вызовами: бесплатный Gemini — ~15 запросов в минуту */
  minIntervalMs?: number;
  /** Пауза перед единственным повтором после 429 */
  retryAfterMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const wasRateLimited = (e: unknown) =>
  e instanceof AiUnavailableError && e.attempts.some((a) => /rate_limited|429/.test(a.reason));

/**
 * Обёртка роутера: считает время и модель каждого шага (через runWithMeta), в реальном режиме держит
 * темп (minIntervalMs) и один раз повторяет вызов после 429 — иначе 20 запросов за 10 секунд упираются
 * в минутный лимит бесплатного Gemini.
 */
export function instrument(router: Pick<AiRouter, "runWithMeta">, o: InstrumentOptions = {}): Instrumented {
  const clock = o.clock ?? (() => performance.now());
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const interval = o.minIntervalMs ?? 0;
  let lastLive = Number.NEGATIVE_INFINITY;
  const stats: Partial<Record<AiStep, StepStat>> = {};
  const call = async <S extends AiStep>(step: S, input: AiInput<S>, opts?: RunOptions) => {
    const wait = lastLive + interval - clock();
    if (wait > 0) await sleep(wait);
    try {
      return await router.runWithMeta(step, input, opts);
    } catch (e) {
      if (!wasRateLimited(e) || !o.retryAfterMs) throw e;
      await sleep(o.retryAfterMs);
      return await router.runWithMeta(step, input, opts);
    }
  };
  return {
    steps: () => structuredClone(stats),
    models: (step) => [...(stats[step]?.models ?? [])],
    ai: {
      async run<S extends AiStep>(step: S, input: AiInput<S>, opts?: RunOptions): Promise<AiOutput<S>> {
        const t0 = clock();
        const res = await call(step, input, opts);
        if (!res.cached) lastLive = clock();
        const s: StepStat = (stats[step] ??= { calls: 0, cached: 0, totalMs: 0, models: [] as string[] });
        s.calls += 1;
        s.totalMs += clock() - t0;
        if (res.cached) s.cached += 1;
        else if (!s.models.includes(res.model)) s.models.push(res.model);
        return res.output;
      },
    },
  };
}

// ---------------- метрики прогона ----------------

export interface KrFlag {
  ko: string;
  back_ru: string;
  ru: string;
  issue: string;
  severity: "minor" | "major";
}

/** Флажок правил корейского без ИИ (eval/kr-check) */
export interface KrRuleIssue {
  chapter: string;
  kind: KrRuleKind;
  rule: string;
  ko: string;
  issue: string;
}
export type KrRuleKind = "paren" | "glossary" | "style" | "names" | "cyrillic" | "other";
export interface KrRules {
  paren: number;
  glossary: number;
  style: number;
  /** #121: имя словаря семьи в главе написано не так, как во всей книге */
  names?: number;
  /** #157: кириллица внутри корейского текста (после #163 конвейер её убирает — должно быть 0) */
  cyrillic?: number;
  other: number;
  issues: KrRuleIssue[];
}

export function krRuleKind(rule: string): KrRuleKind {
  if (rule === "paren") return "paren";
  if (rule === "name:spelling") return "names";
  if (rule === "cyrillic") return "cyrillic";
  // style:parents — 아버님 / 어머님 о своих родителях: решение по глоссарию (#103)
  if (rule.startsWith("glossary:") || rule === "style:parents") return "glossary";
  if (rule === "style:mixed" || rule === "style:hapsyo" || rule === "style:rieul" || rule === "style:grandkids") return "style";
  return "other";
}

/** Правила без ИИ по готовым главам прогона. */
export function checkKrRules(
  chapters: { id: string; title?: string | null; text_ru?: string | null; text_ko?: string | null; quote_ko?: string | null }[],
  glossary: GlossaryEntry[],
  names: { ru: string; ko: string }[] = [],
): KrRules {
  const issues: KrRuleIssue[] = [];
  for (const c of chapters) {
    if (!c.text_ru || !c.text_ko) continue;
    const title = c.title ?? c.id;
    const item = { id: c.id, kind: "chapter" as const, label: title, text_ru: c.text_ru, text_ko: c.text_ko, quote_ko: c.quote_ko ?? undefined };
    for (const f of [...checkItem(item, glossary), ...nameSpellingFlags(item, names)])
      issues.push({ chapter: title, kind: krRuleKind(f.rule), rule: f.rule, ko: f.ko, issue: f.issue });
  }
  const n = (k: KrRuleKind) => issues.filter((i) => i.kind === k).length;
  return { paren: n("paren"), glossary: n("glossary"), style: n("style"), names: n("names"), cyrillic: n("cyrillic"), other: n("other"), issues };
}

export interface ChapterQuality {
  id: string;
  title: string;
  voice: number | null;
  voiceComment: string;
  /** Совпадение смысла KR с RU по обратному переводу, 1–5 */
  meaning: number | null;
  backRu: string;
  flags: KrFlag[];
}

export interface RunMetrics {
  persona: string;
  personaName: string;
  behavior: string | null;
  questions: number;
  followups: number;
  followupsAvg: number;
  chapters: number;
  facts: Record<FactStatus, number> & { total: number };
  /** Были в разговоре, но потеряны или искажены в главах */
  lostInEditing: number;
  lostFacts: string[];
  distortedFacts: string[];
  voiceAvg: number | null;
  meaningAvg: number | null;
  krMajor: number;
  krMinor: number;
  /** Модели обратного перевода и перевода — должны различаться */
  backModels: string[];
  translateModels: string[];
  sameModel: boolean;
  chapterQuality: ChapterQuality[];
  /** Корейский: правила без ИИ (null — глоссарий не передан) */
  krRules?: KrRules | null;
  /** Уточнения и связки агента — эвристики без ИИ */
  dialogue: DialogueChecks;
  /** Сказка по главам прогона (null — глав меньше двух или шаг не ответил) */
  tale: TaleChecks | null;
  /** #231: казахский (книга ru,kk или kk,ru) — kk-check без ИИ и обратный перевод; нет казахского — нет поля */
  kk?: KkRun;
  aiCalls: number;
  stoppedBy: SimResult["stoppedBy"];
  errors: string[];
  wallMs: number;
}

export interface KkRun {
  /** Направление перевода: ru → kk (оригинал русский) или kk → ru (рассказ по-казахски) */
  direction: "ru→kk" | "kk→ru";
  chapters: number;
  flags: KkFlag[];
  major: number;
  minor: number;
  /** ru → kk: «ключевые факты» после обратного перевода kk → ru (null — обратного перевода не было) */
  backFacts: (Record<FactStatus, number> & { total: number }) | null;
  backModels: string[];
  /** Примеры для человека: оригинал, перевод, обратный перевод (обрезаны) */
  samples: { id: string; ru: string; kk: string; back?: string }[];
}

/** Раздел «Манера речи» персонажа — эталон голоса для судьи. */
export function mannerOf(persona: Pick<Persona, "markdown">): string {
  const md = persona.markdown;
  const start = md.search(/^## Манера речи\s*$/m);
  if (start < 0) return "Манера речи не описана.";
  const body = md.slice(start).replace(/^## Манера речи\s*\n/, "");
  const end = body.search(/^## /m);
  return (end < 0 ? body : body.slice(0, end)).trim() || "Манера речи не описана.";
}

export const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function isAiStop(e: unknown): e is Error {
  return e instanceof AiUnavailableError || e instanceof SimBudgetError;
}

export interface EvaluateOptions {
  sim: SimResult;
  ai: Pick<AiRouter, "run">;
  /** Модели translate / back_translate — из instrument() */
  models?: (step: AiStep) => string[];
  wallMs?: number;
  mock?: boolean;
  /** docs/glossary.md, разобранный parseGlossary — для правил корейского без ИИ */
  glossary?: GlossaryEntry[];
  /** #231: роутер другого провайдера для обратного перевода kk → ru (chooseBackMode); нет — без обратного перевода */
  backAi?: Pick<AiRouter, "runWithMeta">;
}

/** Сколько глав ru → kk переводить обратно (по вызову на главу). */
const KK_BACK_MAX = 3;

async function evaluateKk(o: EvaluateOptions, chapters: SimResult["chapters"], errors: string[]): Promise<KkRun | undefined> {
  const kk = chapters.map((c, i) => ({ ...c, id: `ch${i + 1}` })).filter((c) => c.text_kk && c.text_ru);
  if (!kk.length) return undefined;
  const direction = kk.some((c) => c.original === "kk") ? "kk→ru" : "ru→kk";
  const items: KkItem[] = kk.map((c) => ({
    id: c.id,
    label: c.title ?? c.id,
    text_ru: c.text_ru!,
    text_kk: c.text_kk!,
    title_kk: c.title_kk,
    quote_kk: c.quote_kk,
    names: (o.sim.names ?? []).map((n) => n.ru).filter((n) => c.text_ru!.includes(n.slice(0, Math.max(3, n.length - 2)))),
  }));
  // kk — оригинал (живая речь): правила перевода к нему не применяем, факты уже сверены по русскому переводу
  const flags = direction === "ru→kk" ? items.flatMap((i) => checkKk(i)) : [];
  let backFacts: KkRun["backFacts"] = null;
  const backModels: string[] = [];
  const back = new Map<string, string>();
  if (direction === "ru→kk" && o.backAi) {
    try {
      const r = await backTranslateKk(o.backAi, items.slice(0, KK_BACK_MAX));
      flags.push(...r.flags);
      for (const b of r.back) {
        back.set(b.id, b.back_ru);
        if (!backModels.includes(`${b.provider}/${b.model}`)) backModels.push(`${b.provider}/${b.model}`);
      }
      const t = tally(checkFacts(o.sim.persona.keyFacts, [...back.values()].join("\n\n")));
      backFacts = { ...t, total: t.found + t.distorted + t.lost };
    } catch (e) {
      if (!isAiStop(e)) throw e;
      errors.push(`обратный перевод kk: ${e.message}`);
    }
  }
  const { major, minor } = kkTotals(flags);
  return {
    direction,
    chapters: kk.length,
    flags,
    major,
    minor,
    backFacts,
    backModels,
    samples: items.slice(0, 2).map((i) => ({ id: i.id, ru: i.text_ru.slice(0, 300), kk: i.text_kk.slice(0, 300), ...(back.has(i.id) ? { back: back.get(i.id)!.slice(0, 300) } : {}) })),
  };
}

/** Судья + обратный перевод по главам симуляции → метрики прогона. */
export async function evaluateRun(o: EvaluateOptions): Promise<RunMetrics> {
  const { sim } = o;
  const errors: string[] = [];
  const done = sim.chapters
    .map((c, i) => ({ ...c, id: `ch${i + 1}` }))
    .filter((c) => !c.error && c.text_ru && c.transcript.trim())
    .slice(0, BATCH_MAX);
  // Остановка по лимиту вопросов / запросов — штатный режим; ошибка — только «ИИ недоступен».
  if (sim.stoppedBy === "ai_unavailable") errors.push(`интервью остановлено, ИИ недоступен: ${sim.stopDetail ?? ""}`);
  for (const c of sim.chapters) if (c.error) errors.push(`глава не собрана: ${c.error}`);

  const quality = new Map<string, ChapterQuality>(
    done.map((c) => [c.id, { id: c.id, title: c.title ?? "(без названия)", voice: null, voiceComment: "", meaning: null, backRu: "", flags: [] }]),
  );
  let extra = 0;

  if (done.length) {
    try {
      extra += 1;
      const j = await o.ai.run("judge", {
        storytellerName: sim.persona.name,
        manner: mannerOf(sim.persona),
        chapters: done.map((c) => ({ id: c.id, transcript: c.transcript, text_ru: c.text_ru! })),
      });
      for (const s of j.scores) {
        const q = quality.get(s.id);
        if (q) Object.assign(q, { voice: s.voice, voiceComment: s.comment });
      }
    } catch (e) {
      if (!isAiStop(e)) throw e;
      errors.push(`судья: ${e.message}`);
    }

    const kr = done.filter((c) => c.text_ko);
    if (kr.length) {
      try {
        extra += 1;
        const b = await o.ai.run("back_translate", {
          chapters: kr.map((c) => ({ id: c.id, text_ru: c.text_ru!, text_ko: c.text_ko!, quote_ko: c.quote_ko ?? "" })),
        });
        for (const r of b.chapters) {
          const q = quality.get(r.id);
          if (q) Object.assign(q, { meaning: r.meaning, backRu: r.back_ru, flags: r.flags });
        }
      } catch (e) {
        if (!isAiStop(e)) throw e;
        errors.push(`обратный перевод: ${e.message}`);
      }
    }
  }

  let tale: TaleChecks | null = null;
  const taleStories = pickTaleChapters(done);
  if (taleStories.length >= TALE_MIN_CHAPTERS) {
    try {
      extra += 1;
      const source = { storytellerName: sim.persona.name, stories: taleStories };
      tale = checkTale(await o.ai.run("tale", source), source);
    } catch (e) {
      if (!isAiStop(e)) throw e;
      errors.push(`сказка: ${e.message}`);
    }
  }

  const kk = await evaluateKk(o, sim.chapters, errors);

  const chapterQuality = [...quality.values()];
  const t = tally(sim.factsInChapters);
  const followups = sim.questions.reduce((n, q) => n + q.followups, 0);
  const lostInEditing = sim.factsInChapters.filter((c, i) => c.status !== "found" && sim.factsInDialog[i]?.status === "found").length;
  const backModels = o.models?.("back_translate") ?? [];
  const translateModels = o.models?.("translate") ?? [];
  const flags = chapterQuality.flatMap((c) => c.flags);

  return {
    persona: sim.persona.key,
    personaName: sim.persona.name,
    behavior: sim.behavior ?? null,
    questions: sim.questions.length,
    followups,
    followupsAvg: sim.questions.length ? followups / sim.questions.length : 0,
    chapters: sim.chapters.length,
    facts: { ...t, total: sim.factsInChapters.length },
    lostInEditing,
    lostFacts: sim.factsInChapters.filter((c) => c.status === "lost").map((c) => c.fact),
    distortedFacts: sim.factsInChapters.filter((c) => c.status === "distorted").map((c) => `${c.fact} (${c.detail})`),
    voiceAvg: avg(chapterQuality.flatMap((c) => (c.voice === null ? [] : [c.voice]))),
    meaningAvg: avg(chapterQuality.flatMap((c) => (c.meaning === null ? [] : [c.meaning]))),
    krMajor: flags.filter((f) => f.severity === "major").length,
    krMinor: flags.filter((f) => f.severity === "minor").length,
    backModels,
    translateModels,
    sameModel: !o.mock && backModels.some((m) => translateModels.includes(m)),
    chapterQuality,
    krRules: o.glossary ? checkKrRules(done, o.glossary, sim.names ?? []) : null,
    dialogue: checkDialogue(sim),
    tale,
    ...(kk ? { kk } : {}),
    aiCalls: sim.aiCalls.used + extra + (kk?.backModels.length ? Math.min(kk.chapters, KK_BACK_MAX) : 0),
    stoppedBy: sim.stoppedBy,
    errors,
    wallMs: o.wallMs ?? 0,
  };
}

// ---------------- итог ----------------

export interface EvalSummary {
  mode: string;
  mock: boolean;
  label: string;
  startedAt: string;
  commit?: string;
  promptVersions?: Record<string, string>;
  runs: RunMetrics[];
  steps: Partial<Record<AiStep, StepStat>>;
  totals: {
    voiceAvg: number | null;
    voiceOk: boolean | null; // null — mock или нет оценок
    meaningAvg: number | null;
    krMajor: number;
    krMinor: number;
    factsTotal: number;
    found: number;
    lost: number;
    distorted: number;
    lostInEditing: number;
    followupsAvg: number;
    aiCalls: number;
    sameModelRuns: number;
    /** Уточнений агента всего и с флажками (длина, два вопроса, «ты», «подробнее», повтор, давление) */
    followupsTotal: number;
    followupIssues: number;
    /** Уточнение сразу после отказа / боли */
    pressure: number;
    bridgeIssues: number;
    /** Сказок написано и флажков в них */
    tales: number;
    taleIssues: number;
    /** Корейский без ИИ: скобки-пояснения, глоссарий, смешение стилей в абзаце (null — не считалось) */
    krParen?: number | null;
    krGlossary?: number | null;
    krStyle?: number | null;
    krNames?: number | null;
    krCyrillic?: number | null;
  };
}

export function summarize(
  runs: RunMetrics[],
  meta: { mode: string; label?: string; startedAt?: string; commit?: string; steps?: Partial<Record<AiStep, StepStat>>; promptVersions?: Record<string, string> },
): EvalSummary {
  const mock = meta.mode === "mock";
  const voices = runs.flatMap((r) => r.chapterQuality.flatMap((c) => (c.voice === null ? [] : [c.voice])));
  const meanings = runs.flatMap((r) => r.chapterQuality.flatMap((c) => (c.meaning === null ? [] : [c.meaning])));
  const voiceAvg = avg(voices);
  const sum = (f: (r: RunMetrics) => number) => runs.reduce((n, r) => n + f(r), 0);
  const q = sum((r) => r.questions);
  return {
    mode: meta.mode,
    mock,
    label: meta.label ?? "",
    startedAt: meta.startedAt ?? new Date().toISOString(),
    commit: meta.commit,
    promptVersions: meta.promptVersions,
    runs,
    steps: meta.steps ?? {},
    totals: {
      voiceAvg,
      voiceOk: mock || voiceAvg === null ? null : voiceAvg >= VOICE_TARGET,
      meaningAvg: avg(meanings),
      krMajor: sum((r) => r.krMajor),
      krMinor: sum((r) => r.krMinor),
      factsTotal: sum((r) => r.facts.total),
      found: sum((r) => r.facts.found),
      lost: sum((r) => r.facts.lost),
      distorted: sum((r) => r.facts.distorted),
      lostInEditing: sum((r) => r.lostInEditing),
      followupsAvg: q ? sum((r) => r.followups) / q : 0,
      aiCalls: sum((r) => r.aiCalls),
      sameModelRuns: runs.filter((r) => r.sameModel).length,
      followupsTotal: sum((r) => r.dialogue?.followups ?? 0),
      followupIssues: sum((r) => r.dialogue?.followupIssues.length ?? 0),
      pressure: sum((r) => r.dialogue?.pressure ?? 0),
      bridgeIssues: sum((r) => r.dialogue?.bridgeIssues.length ?? 0),
      tales: runs.filter((r) => r.tale).length,
      taleIssues: sum((r) => r.tale?.issues.length ?? 0),
      ...krTotals(runs),
    },
  };
}

function krTotals(runs: RunMetrics[]) {
  const counted = runs.filter((r) => r.krRules);
  if (!counted.length) return { krParen: null, krGlossary: null, krStyle: null, krNames: null, krCyrillic: null };
  const sum = (k: "paren" | "glossary" | "style" | "names" | "cyrillic") => counted.reduce((n, r) => n + (r.krRules![k] ?? 0), 0);
  return { krParen: sum("paren"), krGlossary: sum("glossary"), krStyle: sum("style"), krNames: sum("names"), krCyrillic: sum("cyrillic") };
}

// ---------------- Markdown ----------------

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s*\n+\s*/g, " ").trim();
const n1 = (x: number | null | undefined) => (x === null || x === undefined ? "—" : x.toFixed(1));
const n2 = (x: number | null | undefined) => (x === null || x === undefined ? "—" : x.toFixed(2));
const sec = (ms: number) => `${(ms / 1000).toFixed(1)} с`;

export const MOCK_NOTE = "⚠️ **mock, оценка не показательна**: ответы, главы и оценки — из заглушки (fixtures), без настоящих моделей.";

function targetLine(s: EvalSummary): string {
  if (s.mock) return `🎯 Цель MLP — средний голос ≥ ${VOICE_TARGET} из 5: в mock не проверяется (заглушка ставит 3).`;
  if (s.totals.voiceAvg === null) return `🎯 Цель MLP — средний голос ≥ ${VOICE_TARGET} из 5: оценок нет (судья не ответил).`;
  return `🎯 Цель MLP — средний голос ≥ ${VOICE_TARGET} из 5: **${n2(s.totals.voiceAvg)}** ${s.totals.voiceOk ? "✅ достигнута" : "❌ не достигнута"}`;
}

type Better = "up" | "down" | "none";
interface MetricDef {
  name: string;
  get: (s: EvalSummary) => number | null;
  better: Better;
  fmt: (x: number | null) => string;
}

export const METRICS: MetricDef[] = [
  { name: `Голос, среднее 1–5 (цель ≥ ${VOICE_TARGET})`, get: (s) => s.totals.voiceAvg, better: "up", fmt: n2 },
  { name: "Факты потеряны", get: (s) => s.totals.lost, better: "down", fmt: (x) => String(x ?? "—") },
  { name: "Факты искажены", get: (s) => s.totals.distorted, better: "down", fmt: (x) => String(x ?? "—") },
  { name: "Потеряно при сборке главы", get: (s) => s.totals.lostInEditing, better: "down", fmt: (x) => String(x ?? "—") },
  { name: "Уточнений на вопрос", get: (s) => s.totals.followupsAvg, better: "none", fmt: n2 },
  { name: "KR: смысл по обратному переводу 1–5", get: (s) => s.totals.meaningAvg, better: "up", fmt: n2 },
  { name: "KR: флажки major", get: (s) => s.totals.krMajor, better: "down", fmt: (x) => String(x ?? "—") },
  { name: "KR: флажки minor", get: (s) => s.totals.krMinor, better: "down", fmt: (x) => String(x ?? "—") },
  { name: "KR без ИИ: пояснения в скобках, которых нет в оригинале", get: (s) => s.totals.krParen ?? null, better: "down", fmt: (x) => String(x ?? "—") },
  { name: "KR без ИИ: отклонения от глоссария (вкл. 아버님 / 어머님 о своих)", get: (s) => s.totals.krGlossary ?? null, better: "down", fmt: (x) => String(x ?? "—") },
  { name: "KR без ИИ: смешение 해요체 / 한다체 в абзаце, 습니다체, ㄹ + -으셨", get: (s) => s.totals.krStyle ?? null, better: "down", fmt: (x) => String(x ?? "—") },
  { name: "KR без ИИ: имя написано не как в словаре семьи (одно имя — одно написание)", get: (s) => s.totals.krNames ?? null, better: "down", fmt: (x) => String(x ?? "—") },
  { name: "KR без ИИ: кириллица в корейском", get: (s) => s.totals.krCyrillic ?? null, better: "down", fmt: (x) => String(x ?? "—") },
  { name: "Уточнения: флажки (длина, два вопроса, «ты», «подробнее», повтор)", get: (s) => s.totals.followupIssues ?? null, better: "down", fmt: (x) => String(x ?? "—") },
  { name: "Уточнения: давление после отказа / боли", get: (s) => s.totals.pressure ?? null, better: "down", fmt: (x) => String(x ?? "—") },
  { name: "Связки: флажки (длина, вопрос, лесть, повтор)", get: (s) => s.totals.bridgeIssues ?? null, better: "down", fmt: (x) => String(x ?? "—") },
  { name: "Сказка: флажки (страницы, длина, страшное, чужие годы / имена, финал)", get: (s) => s.totals.taleIssues ?? null, better: "down", fmt: (x) => String(x ?? "—") },
  { name: "Запросов к ИИ", get: (s) => s.totals.aiCalls, better: "none", fmt: (x) => String(x ?? "—") },
];

export function delta(before: number | null, after: number | null, better: Better): string {
  if (before === null || after === null) return "—";
  const d = after - before;
  if (Math.abs(d) < 1e-9) return "=";
  const txt = `${d > 0 ? "+" : ""}${Number.isInteger(d) ? d : d.toFixed(2)}`;
  if (better === "none") return txt;
  const good = better === "up" ? d > 0 : d < 0;
  return `${txt} ${good ? "🟢" : "🔴"}`;
}

function compareTable(after: EvalSummary, before: EvalSummary): string[] {
  return [
    `| Метрика | До${before.label ? ` (${cell(before.label)})` : ""} | После${after.label ? ` (${cell(after.label)})` : ""} | Δ |`,
    "| --- | --- | --- | --- |",
    ...METRICS.map((m) => {
      const b = m.get(before);
      const a = m.get(after);
      return `| ${m.name} | ${m.fmt(b)} | ${m.fmt(a)} | ${delta(b, a, m.better)} |`;
    }),
  ];
}

function totalsTable(s: EvalSummary): string[] {
  return ["| Метрика | Значение |", "| --- | --- |", ...METRICS.map((m) => `| ${m.name} | ${m.fmt(m.get(s))} |`)];
}

function runsTable(s: EvalSummary): string[] {
  return [
    "| Персонаж | Профиль | Вопросов | Уточн./вопрос | Факты ✅/⚠️/❌ | Голос | KR смысл | KR флажки major/minor | ИИ | Время |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...s.runs.map(
      (r) =>
        `| ${r.persona} | ${cell(r.behavior ?? "—")} | ${r.questions} | ${n2(r.followupsAvg)} | ${r.facts.found}/${r.facts.distorted}/${r.facts.lost} из ${r.facts.total} | ${n1(r.voiceAvg)} | ${n1(r.meaningAvg)} | ${r.krMajor}/${r.krMinor} | ${r.aiCalls} | ${sec(r.wallMs)} |`,
    ),
  ];
}

function stepsTable(s: EvalSummary): string[] {
  const rows = Object.entries(s.steps).map(([step, st]) => {
    const live = st!.calls - st!.cached;
    return `| ${step} | ${st!.calls} | ${st!.cached} | ${st!.calls ? sec(st!.totalMs / st!.calls) : "—"} | ${cell(st!.models.join(", ") || (live ? "—" : "кэш"))} |`;
  });
  return ["| Шаг | Вызовов | Из кэша | Среднее время | Модели |", "| --- | --- | --- | --- | --- |", ...rows];
}

function modelWarnings(s: EvalSummary): string[] {
  if (s.mock) return [];
  const out: string[] = [];
  for (const r of s.runs.filter((x) => x.sameModel)) {
    out.push(`- ⚠️ ${r.persona}: обратный перевод сделан той же моделью, что и перевод (${r.backModels.join(", ")}) — проверка KR слабее, флажки могут быть пропущены.`);
  }
  return out;
}

function flagRows(s: EvalSummary, limit = Number.POSITIVE_INFINITY): string[] {
  const all = s.runs.flatMap((r) =>
    r.chapterQuality.flatMap((c) => c.flags.map((f) => ({ r, c, f }))),
  );
  all.sort((a, b) => (a.f.severity === b.f.severity ? 0 : a.f.severity === "major" ? -1 : 1));
  const rows = all.slice(0, limit).map(
    ({ r, c, f }) =>
      `| ${f.severity === "major" ? "🔴" : "🟡"} | ${r.persona} · ${cell(c.title)} | ${cell(f.ko)} | ${cell(f.back_ru)} | ${cell(f.ru)} | ${cell(f.issue)} |`,
  );
  if (!rows.length) return ["Сомнительных мест в корейском не найдено."];
  const out = ["| | Глава | KR | Обратно | Оригинал RU | Что не так |", "| --- | --- | --- | --- | --- | --- |", ...rows];
  if (all.length > limit) out.push("", `…и ещё ${all.length - limit} — в полном отчёте.`);
  return out;
}

function krRuleRows(s: EvalSummary, limit = Number.POSITIVE_INFINITY): string[] {
  const all = s.runs.flatMap((r) => (r.krRules?.issues ?? []).filter((i) => i.kind !== "other").map((i) => ({ r, i })));
  if (!all.length) return [s.runs.some((r) => r.krRules) ? "Флажков нет." : "Не считалось (глоссарий не передан)."];
  const rows = all.slice(0, limit).map(({ r, i }) => `| ${r.persona} · ${cell(i.chapter)} | \`${i.rule}\` | ${cell(i.ko)} | ${cell(i.issue)} |`);
  const out = ["| Глава | Правило | KR | Что не так |", "| --- | --- | --- | --- |", ...rows];
  if (all.length > limit) out.push("", `…и ещё ${all.length - limit} — в полном отчёте.`);
  return out;
}

/** Полный отчёт: eval/reports/<дата>.md */
function issueRows(items: { persona: string; it: TextIssue }[], limit: number): string[] {
  if (!items.length) return ["Флажков нет."];
  const rows = items.slice(0, limit).map(({ persona, it }) => `| ${persona} | ${cell(it.issue)} | ${cell(it.text).slice(0, 220)} |`);
  const more = items.length > limit ? [``, `…и ещё ${items.length - limit}`] : [];
  return ["| Персонаж | Флажок | Текст |", "| --- | --- | --- |", ...rows, ...more];
}

/** Уточнения, связки и сказки — флажки и сами тексты (чтобы оценить глазами тон). */
function agentSection(s: EvalSummary, limit: number): string[] {
  const out: string[] = [];
  const fu = s.runs.flatMap((r) => (r.dialogue?.followupIssues ?? []).map((it) => ({ persona: r.persona, it })));
  const br = s.runs.flatMap((r) => (r.dialogue?.bridgeIssues ?? []).map((it) => ({ persona: r.persona, it })));
  out.push(`**Уточнения** — всего ${s.totals.followupsTotal ?? 0}, флажков ${fu.length}, давление ${s.totals.pressure ?? 0}:`, "", ...issueRows(fu, limit), "");
  out.push(`**Связки** — флажков ${br.length}:`, "", ...issueRows(br, limit), "");
  for (const r of s.runs) {
    const fx = r.dialogue?.followupTexts ?? [];
    const bx = r.dialogue?.bridgeTexts ?? [];
    if (fx.length) out.push(`Уточнения ${r.persona}: ${fx.slice(0, limit).map((t) => `«${cell(t)}»`).join(" · ")}`, "");
    if (bx.length) out.push(`Связки ${r.persona}: ${bx.slice(0, limit).map((t) => `«${cell(t)}»`).join(" · ")}`, "");
  }
  for (const r of s.runs) {
    if (!r.tale) continue;
    out.push(`**Сказка — ${r.persona}: «${cell(r.tale.title)}»** (флажков ${r.tale.issues.length})`, "");
    r.tale.pages.forEach((p, i) => out.push(`${i + 1}. ${cell(p)}`));
    out.push("");
    if (r.tale.issues.length) out.push(...r.tale.issues.map((it) => `- ⚠️ ${cell(it.issue)}`), "");
  }
  return out;
}

export function renderEvalReport(s: EvalSummary, before?: EvalSummary): string {
  const out: string[] = [
    `# Оценка качества${s.label ? `: ${s.label}` : ""}`,
    "",
    `- Дата: ${s.startedAt}${s.commit ? ` · коммит \`${s.commit.slice(0, 7)}\`` : ""}`,
    `- Режим ИИ: ${s.mode}`,
    `- Прогонов: ${s.runs.length} (${s.runs.map((r) => `${r.persona}${r.behavior ? ` [${r.behavior}]` : ""}`).join(", ")})`,
  ];
  if (s.promptVersions) out.push(`- Версии промптов: ${Object.entries(s.promptVersions).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  out.push("");
  if (s.mock) out.push(MOCK_NOTE, "");
  out.push(targetLine(s), "", ...modelWarnings(s), "");

  out.push("## Итог", "", ...(before ? compareTable(s, before) : totalsTable(s)), "");
  out.push("## По прогонам", "", ...runsTable(s), "");
  out.push("## Время шагов", "", ...stepsTable(s), "");
  out.push("## Корейский: обратный перевод KR → RU", "", ...flagRows(s), "");
  out.push("## Корейский: правила без ИИ (скобки, глоссарий, стиль)", "", ...krRuleRows(s), "");
  out.push("## Уточнения, связки, сказка (эвристики без ИИ)", "", ...agentSection(s, Number.POSITIVE_INFINITY), "");
  if (s.runs.some((r) => r.kk)) out.push("## Казахский (#231): kk-check и обратный перевод", "", ...kkSection(s, Number.POSITIVE_INFINITY, true), "");

  out.push("## Главы: голос и смысл", "");
  for (const r of s.runs) {
    out.push(`### ${r.personaName} (${r.persona})${r.behavior ? ` · ${r.behavior}` : ""}`, "");
    if (r.backModels.length || r.translateModels.length) {
      out.push(`Перевод: ${r.translateModels.join(", ") || "кэш"} · обратный перевод: ${r.backModels.join(", ") || "кэш"}`, "");
    }
    if (r.lostFacts.length) out.push(`Потеряны факты: ${r.lostFacts.map(cell).join("; ")}`, "");
    if (r.distortedFacts.length) out.push(`Искажены факты: ${r.distortedFacts.map(cell).join("; ")}`, "");
    if (r.errors.length) out.push(...r.errors.map((e) => `> ${cell(e)}`), "");
    if (!r.chapterQuality.length) {
      out.push("Глав для оценки нет.", "");
      continue;
    }
    out.push("| Глава | Голос | Комментарий судьи | KR смысл | Флажков |", "| --- | --- | --- | --- | --- |");
    for (const c of r.chapterQuality) {
      out.push(`| ${cell(c.title)} | ${c.voice ?? "—"} | ${cell(c.voiceComment || "—")} | ${c.meaning ?? "—"} | ${c.flags.length} |`);
    }
    out.push("");
  }
  out.push(
    "---",
    "Как читать — `eval/README.md`. Факты сверяются эвристикой (годы точно, слова по основе), голос и KR оценивает модель — спорное проверяйте глазами.",
  );
  return out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

/** #231: казахский по прогонам — направление, флажки kk-check, факты после обратного перевода, примеры. */
function kkSection(s: EvalSummary, limit: number, samples: boolean): string[] {
  const runs = s.runs.filter((r) => r.kk);
  const out = [
    KK_NOTE,
    "",
    "| Персонаж | Направление | Глав | Флажки 🔴/🟡 | Факты после обратного перевода ✅/⚠️/❌ | Обратный перевод |",
    "| --- | --- | --- | --- | --- | --- |",
    ...runs.map((r) => {
      const k = r.kk!;
      const bf = k.backFacts ? `${k.backFacts.found}/${k.backFacts.distorted}/${k.backFacts.lost} из ${k.backFacts.total}` : k.direction === "kk→ru" ? "— (факты — по русскому переводу выше)" : "—";
      return `| ${r.persona} | ${k.direction} | ${k.chapters} | ${k.major}/${k.minor} | ${bf} | ${cell(k.backModels.join(", ") || "—")} |`;
    }),
    "",
    ...kkFlagRows(runs.flatMap((r) => r.kk!.flags.map((flag) => ({ persona: r.persona, flag }))), limit),
  ];
  if (samples)
    for (const r of runs)
      for (const x of r.kk!.samples)
        out.push("", `**${r.persona} · ${x.id}**`, "", `- RU: ${cell(x.ru)}`, `- KK: ${cell(x.kk)}`, ...(x.back ? [`- KK → RU: ${cell(x.back)}`] : []));
  return out;
}

export const COMMENT_MARKER = "<!-- kniga-eval -->";

/** Короткий комментарий в PR: «до / после», цель, главные флажки KR. */
export function renderPrComment(s: EvalSummary, before?: EvalSummary, opts: { link?: string; note?: string } = {}): string {
  const out: string[] = [COMMENT_MARKER, `### 📊 Оценка качества промптов${s.label ? ` — ${s.label}` : ""}`, ""];
  if (s.mock) out.push(MOCK_NOTE, "");
  if (opts.note) out.push(opts.note, "");
  out.push(targetLine(s), "", ...modelWarnings(s), "");
  out.push(...(before ? compareTable(s, before) : totalsTable(s)), "");
  const errs = s.runs.flatMap((r) => r.errors.map((e) => `- ${r.persona}: ${cell(e).slice(0, 300)}`));
  if (errs.length) out.push(`⚠️ **Прогон неполный** — цифры ниже не показательны:`, "", ...errs.slice(0, 6), "");
  out.push("<details><summary>По прогонам</summary>", "", ...runsTable(s), "", "</details>", "");
  out.push("<details><summary>Корейский: сомнительные места (обратный перевод)</summary>", "", ...flagRows(s, 10), "", "</details>", "");
  out.push("<details><summary>Корейский: правила без ИИ (скобки, глоссарий, стиль)</summary>", "", ...krRuleRows(s, 10), "", "</details>", "");
  out.push("<details><summary>Уточнения, связки, сказка</summary>", "", ...agentSection(s, 12), "", "</details>", "");
  if (s.runs.some((r) => r.kk)) out.push("<details><summary>Казахский (#231): kk-check и обратный перевод</summary>", "", ...kkSection(s, 12, false), "", "</details>", "");
  if (opts.link) out.push(`Полный отчёт и главы — [артефакт запуска](${opts.link}).`);
  return out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}
