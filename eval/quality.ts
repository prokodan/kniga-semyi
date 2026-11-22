// Оценка качества по симулятору (I11): прогон персонажа (I15) → метрики → отчёт и комментарий в PR.
//   • факты: потерянные / искажённые против «Ключевых фактов» (eval/sim/facts — без ИИ);
//   • уточнения: среднее на вопрос;
//   • голос: LLM-судья ai.run("judge") 1–5 по каждой главе (промпт eval/judge.md), цель MLP — среднее ≥ 4;
//   • корейский: обратный перевод ai.run("back_translate") KR→RU ДРУГОЙ моделью, чем translate,
//     с флажками сомнительных мест (промпт eval/back_translate.md);
//   • время шага: среднее время ai.run по каждому шагу.
// ИИ — только через роутер. В mock всё работает бесплатно и честно помечается «не показательна».
import type { AiRouter, RunOptions } from "@/lib/ai/router";
import { AiUnavailableError, type AiInput, type AiOutput, type AiStep } from "@/lib/ai/types";
import { SimBudgetError } from "./sim/budget";
import { tally, type FactStatus } from "./sim/facts";
import type { Persona } from "./sim/persona";
import type { SimResult } from "./sim/run";

export const VOICE_TARGET = 4;
/** Вызовов ИИ после симуляции на один прогон: judge + back_translate (главы идут одним пакетом). */
export const QUALITY_CALLS = 2;
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

/** Обёртка роутера: считает время и модель каждого шага (через runWithMeta). */
export function instrument(router: Pick<AiRouter, "runWithMeta">, clock: () => number = () => performance.now()): Instrumented {
  const stats: Partial<Record<AiStep, StepStat>> = {};
  return {
    steps: () => structuredClone(stats),
    models: (step) => [...(stats[step]?.models ?? [])],
    ai: {
      async run<S extends AiStep>(step: S, input: AiInput<S>, opts?: RunOptions): Promise<AiOutput<S>> {
        const t0 = clock();
        const res = await router.runWithMeta(step, input, opts);
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
  aiCalls: number;
  stoppedBy: SimResult["stoppedBy"];
  errors: string[];
  wallMs: number;
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
}

/** Судья + обратный перевод по главам симуляции → метрики прогона. */
export async function evaluateRun(o: EvaluateOptions): Promise<RunMetrics> {
  const { sim } = o;
  const errors: string[] = [];
  const done = sim.chapters
    .map((c, i) => ({ ...c, id: `ch${i + 1}` }))
    .filter((c) => !c.error && c.text_ru && c.transcript.trim())
    .slice(0, BATCH_MAX);
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
    aiCalls: sim.aiCalls.used + extra,
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
    },
  };
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

/** Полный отчёт: eval/reports/<дата>.md */
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

export const COMMENT_MARKER = "<!-- kniga-eval -->";

/** Короткий комментарий в PR: «до / после», цель, главные флажки KR. */
export function renderPrComment(s: EvalSummary, before?: EvalSummary, opts: { link?: string; note?: string } = {}): string {
  const out: string[] = [COMMENT_MARKER, `### 📊 Оценка качества промптов${s.label ? ` — ${s.label}` : ""}`, ""];
  if (s.mock) out.push(MOCK_NOTE, "");
  if (opts.note) out.push(opts.note, "");
  out.push(targetLine(s), "", ...modelWarnings(s), "");
  out.push(...(before ? compareTable(s, before) : totalsTable(s)), "");
  out.push("<details><summary>По прогонам</summary>", "", ...runsTable(s), "", "</details>", "");
  out.push("<details><summary>Корейский: сомнительные места (обратный перевод)</summary>", "", ...flagRows(s, 10), "", "</details>", "");
  if (opts.link) out.push(`Полный отчёт и главы — [артефакт запуска](${opts.link}).`);
  return out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}
