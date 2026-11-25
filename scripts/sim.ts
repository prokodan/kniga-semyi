// Текстовый симулятор интервью (I15).
//   npm run sim -- --persona kim [--behavior wanders|all] [--questions N] [--max-calls 60] [--pdf]
// По умолчанию AI_MODE=mock (бесплатно). Реальный режим: GEMINI_API_KEY в .env.local и AI_MODE=gemini|auto.
// В реальном режиме один прогон — не больше --max-calls запросов к ИИ (по умолчанию 60; квота ~500 в сутки).
import { existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { createRouter } from "@/lib/ai/router";
import { MemoryStore } from "@/lib/ai/store";
import { getAiMode } from "@/lib/env";
import { DEFAULT_MAX_CALLS } from "@/eval/sim/budget";
import { tally } from "@/eval/sim/facts";
import { BEHAVIORS, listPersonas, loadPersona, resolveBehavior } from "@/eval/sim/persona";
import { writeReport } from "@/eval/sim/report";
import { runSimulation } from "@/eval/sim/run";

function loadLocalEnv() {
  // Ключи — только из своего .env.local; в лог их не печатаем.
  for (const f of [".env.local", ".env"]) {
    const p = path.join(process.cwd(), f);
    if (existsSync(p)) process.loadEnvFile(p);
  }
}

function usage(): never {
  console.error(
    [
      "Использование: npm run sim -- --persona <kim|pak|tsoi> [--behavior <профиль>|all] [--questions N] [--max-calls N] [--pdf]",
      `Персонажи: ${listPersonas().join(", ")}`,
      `Профили: ${BEHAVIORS.join(", ")} (all — все по очереди, только в mock)`,
    ].join("\n"),
  );
  process.exit(2);
}

async function main() {
  const { values } = parseArgs({
    options: {
      persona: { type: "string" },
      behavior: { type: "string" },
      questions: { type: "string" },
      "max-calls": { type: "string" },
      pdf: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help || !values.persona) usage();

  loadLocalEnv();
  const mode = getAiMode();
  const real = mode !== "mock";
  const maxQuestions = values.questions ? Number(values.questions) : undefined;
  if (maxQuestions !== undefined && (!Number.isInteger(maxQuestions) || maxQuestions < 1)) usage();
  const maxCalls = values["max-calls"] ? Number(values["max-calls"]) : real ? DEFAULT_MAX_CALLS : undefined;
  if (maxCalls !== undefined && (!Number.isInteger(maxCalls) || maxCalls < 5)) usage();

  const persona = loadPersona(values.persona);
  const behaviors = values.behavior === "all" ? [...BEHAVIORS] : [values.behavior];
  if (values.behavior === "all" && real) {
    console.error("--behavior all в реальном режиме съест до 7 × лимит запросов. Запускайте профили по одному.");
    process.exit(2);
  }

  const router = createRouter({ store: new MemoryStore() });
  console.log(`Режим ИИ: ${mode}${maxCalls ? `, лимит ${maxCalls} запросов на прогон` : ""}`);

  for (const b of behaviors) {
    const behavior = resolveBehavior(persona, b);
    const result = await runSimulation({ persona, behavior, maxQuestions, maxCalls, ai: router, mode });
    const file = writeReport(result, { explicitBehavior: b });
    const t = tally(result.factsInChapters);
    const followups = result.questions.reduce((n, q) => n + q.followups, 0);
    console.log(
      `${persona.key}${b ? ` [${b}]` : ""}: вопросов ${result.questions.length}, уточнений ${followups}, глав ${result.chapters.length}, ` +
        `факты ✅${t.found} ⚠️${t.distorted} ❌${t.lost}, ИИ ${result.aiCalls.used} → ${path.relative(process.cwd(), file)}`,
    );
  }

  if (values.pdf) {
    // Книга PDF — задача I5 (lib/book). Контракт сборки ещё не опубликован, поэтому здесь только флаг.
    console.log("--pdf: сборка книги (I5) ещё не готова — пропущено.");
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
