// Оценка качества по симулятору (I11).
//   npm run eval                                    # 3 персонажа × профили по умолчанию, mock — бесплатно
//   npm run eval -- --personas kim,pak --behaviors one-word,long --questions 4 --max-calls 24
//   npm run eval -- --compare eval/reports/before.json --label "после V1" --comment comment.md
// Пишет eval/reports/<дата>.md и <дата>.json (или --out / --json). Как читать — eval/README.md.
// Реальный режим: GEMINI_API_KEY в .env.local и AI_MODE=gemini|auto. Лимит — --max-calls запросов на прогон
// (по умолчанию 24) и --total-max на весь запуск (по умолчанию 150): квота Gemini ~500/сутки общая с продом.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_MAX_CALLS } from "@/eval/sim/budget";
import { BEHAVIORS, listPersonas, loadPersona, resolveBehavior } from "@/eval/sim/persona";
import { REPORTS_DIR } from "@/eval/sim/report";
import { runSimulation } from "@/eval/sim/run";
import { EvalStore } from "@/eval/store";
import { parseGlossary } from "@/eval/kr-check";
import { evaluateRun, instrument, QUALITY_CALLS, renderEvalReport, renderPrComment, summarize, type EvalSummary, type RunMetrics } from "@/eval/quality";
import { promptPath } from "@/lib/ai/prompts";
import { createRouter } from "@/lib/ai/router";
import { AI_STEPS } from "@/lib/ai/types";
import { sha256 } from "@/lib/ai/util";
import { getAiMode } from "@/lib/env";

const REAL_MAX_CALLS = 24;
const TOTAL_MAX = 150;

function loadLocalEnv() {
  // Ключи — только из своего .env.local; в лог их не печатаем.
  for (const f of [".env.local", ".env"]) {
    const p = path.join(process.cwd(), f);
    if (existsSync(p)) process.loadEnvFile(p);
  }
}

function usage(msg?: string): never {
  if (msg) console.error(`Ошибка: ${msg}`);
  console.error(
    [
      "Использование: npm run eval -- [--personas kim,pak,tsoi] [--behaviors default|all|<профиль,…>] [--questions N]",
      "                               [--max-calls N] [--total-max N] [--out file.md] [--json file.json]",
      "                               [--compare before.json] [--label текст] [--comment file.md] [--link url]",
      `Персонажи: ${listPersonas().join(", ")}`,
      `Профили: default (у каждого персонажа свои), all (все по очереди, только mock), ${BEHAVIORS.join(", ")}`,
    ].join("\n"),
  );
  process.exit(2);
}

function intOpt(v: string | undefined, name: string, min: number): number | undefined {
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) usage(`--${name} должно быть целым ≥ ${min}`);
  return n;
}

function promptVersions(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const step of AI_STEPS) {
    const file = promptPath(step);
    if (existsSync(file)) out[step] = sha256(readFileSync(file, "utf8")).slice(0, 12);
  }
  return out;
}

async function main() {
  const { values } = parseArgs({
    options: {
      personas: { type: "string" },
      behaviors: { type: "string", default: "default" },
      questions: { type: "string" },
      "max-calls": { type: "string" },
      "total-max": { type: "string" },
      out: { type: "string" },
      json: { type: "string" },
      compare: { type: "string" },
      label: { type: "string", default: "" },
      comment: { type: "string" },
      link: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) usage();

  loadLocalEnv();
  const mode = getAiMode();
  const real = mode !== "mock";

  const known = listPersonas();
  const personas = values.personas ? values.personas.split(",").map((s) => s.trim()).filter(Boolean) : known;
  for (const p of personas) if (!known.includes(p)) usage(`нет персонажа «${p}»`);

  const b = values.behaviors.trim();
  if (b === "all" && real) usage("--behaviors all в реальном режиме съест квоту: перечислите 1–2 профиля");
  const behaviorKeys: (string | undefined)[] = b === "default" ? [undefined] : b === "all" ? [...BEHAVIORS] : b.split(",").map((s) => s.trim());

  const maxQuestions = intOpt(values.questions, "questions", 1);
  const maxCalls = intOpt(values["max-calls"], "max-calls", 5 + QUALITY_CALLS) ?? (real ? REAL_MAX_CALLS : undefined);
  const totalMax = intOpt(values["total-max"], "total-max", 1) ?? TOTAL_MAX;
  const runsCount = personas.length * behaviorKeys.length;
  if (real && maxCalls! > DEFAULT_MAX_CALLS) usage(`--max-calls не больше ${DEFAULT_MAX_CALLS} на прогон`);
  if (real && runsCount * maxCalls! > totalMax) {
    usage(`${runsCount} прогонов × ${maxCalls} запросов = ${runsCount * maxCalls!} > --total-max ${totalMax}. Уменьшите --max-calls или число прогонов.`);
  }

  const store = new EvalStore({
    routesFile: process.env.EVAL_ROUTES_FILE?.trim() || undefined,
    cacheFile: process.env.EVAL_CACHE_FILE?.trim() || undefined,
    model: process.env.EVAL_MODEL?.trim() || undefined,
  });
  // Бесплатный Gemini: ~15 запросов в минуту → пауза 6,5 с (≈ 9/мин, как в sim) между настоящими вызовами и повтор после 429.
  const interval = Number(process.env.EVAL_MIN_INTERVAL_MS ?? 6500);
  const inst = instrument(createRouter({ store }), real ? { minIntervalMs: interval, retryAfterMs: Number(process.env.EVAL_RETRY_WAIT_MS ?? 65_000) } : {});
  console.log(`Режим ИИ: ${mode}${real ? `, до ${maxCalls} запросов на прогон, ${runsCount} прогонов` : " (бесплатно, оценка не показательна)"}`);
  if (store.cachedAtStart) console.log(`Кэш ответов: ${store.cachedAtStart} записей`);

  // Правила корейского без ИИ (#103): скобки, глоссарий, стиль. Нет файла — метрики «—».
  const glossary = existsSync("docs/glossary.md") ? parseGlossary(readFileSync("docs/glossary.md", "utf8")) : undefined;

  const runs: RunMetrics[] = [];
  for (const key of personas) {
    const persona = loadPersona(key);
    for (const bk of behaviorKeys) {
      const behavior = resolveBehavior(persona, bk);
      const t0 = performance.now();
      const sim = await runSimulation({
        persona,
        behavior,
        maxQuestions,
        maxCalls: maxCalls === undefined ? undefined : maxCalls - QUALITY_CALLS,
        ai: inst.ai,
        mode,
      });
      const m = await evaluateRun({ sim, ai: inst.ai, models: inst.models, mock: !real, wallMs: 0, glossary });
      m.wallMs = performance.now() - t0;
      runs.push(m);
      console.log(
        `${key}${behavior ? ` [${behavior}]` : ""}: голос ${m.voiceAvg?.toFixed(2) ?? "—"}, факты ✅${m.facts.found} ⚠️${m.facts.distorted} ❌${m.facts.lost}, ` +
          `уточнений/вопрос ${m.followupsAvg.toFixed(2)}, KR смысл ${m.meaningAvg?.toFixed(1) ?? "—"} флажков ${m.krMajor}/${m.krMinor}, ИИ ${m.aiCalls}`,
      );
      for (const e of m.errors) console.log(`  ⚠️ ${e.slice(0, 400)}`);
    }
  }

  const summary = summarize(runs, {
    mode,
    label: values.label,
    commit: process.env.GITHUB_SHA,
    steps: inst.steps(),
    promptVersions: promptVersions(),
  });
  const before = values.compare ? (JSON.parse(readFileSync(values.compare, "utf8")) as EvalSummary) : undefined;

  const date = summary.startedAt.slice(0, 10);
  mkdirSync(REPORTS_DIR, { recursive: true });
  const out = values.out ?? path.join(REPORTS_DIR, `${date}.md`);
  const json = values.json ?? out.replace(/\.md$/, "") + ".json";
  mkdirSync(path.dirname(out), { recursive: true });
  mkdirSync(path.dirname(json), { recursive: true });
  writeFileSync(out, renderEvalReport(summary, before), "utf8");
  writeFileSync(json, JSON.stringify(summary, null, 2), "utf8");
  if (values.comment) writeFileSync(values.comment, renderPrComment(summary, before, { link: values.link }), "utf8");

  const t = summary.totals;
  console.log(
    `Итог: голос ${t.voiceAvg?.toFixed(2) ?? "—"}${summary.mock ? " (mock)" : t.voiceOk ? " ✅ ≥ 4" : " ❌ < 4"}, потеряно ${t.lost}, искажено ${t.distorted}, ` +
      `KR флажков ${t.krMajor}/${t.krMinor}, ИИ ${t.aiCalls} → ${path.relative(process.cwd(), out)}`,
  );
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
