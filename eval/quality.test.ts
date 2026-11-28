// Оценка качества (I11) — всё в mock, без ключей и базы.
import { describe, expect, it } from "vitest";
import { createRouter } from "@/lib/ai/router";
import type { RunResult } from "@/lib/ai/router";
import { MemoryStore } from "@/lib/ai/store";
import type { AiInput, AiOutput, AiStep } from "@/lib/ai/types";
import {
  COMMENT_MARKER,
  delta,
  evaluateRun,
  instrument,
  mannerOf,
  MOCK_NOTE,
  renderEvalReport,
  renderPrComment,
  summarize,
  checkKrRules,
  krRuleKind,
  VOICE_KK_SKIPPED,
  VOICE_TARGET,
} from "./quality";
import { readFileSync } from "node:fs";
import { parseGlossary } from "./kr-check";
import { deriveEvalSteps, evalFlash, evalRoute } from "./store";
import { loadPersona } from "./sim/persona";
import { runSimulation } from "./sim/run";

const kim = loadPersona("kim");

/** Роутер-заглушка с подменой отдельных шагов и «моделью» на каждый шаг. */
function fakeRouter(over: { [S in AiStep]?: (i: AiInput<S>) => AiOutput<S> } = {}, models: Partial<Record<AiStep, string>> = {}) {
  const inner = createRouter({ store: new MemoryStore(), mode: () => "mock" });
  return {
    async runWithMeta<S extends AiStep>(step: S, input: AiInput<S>): Promise<RunResult<S>> {
      const fn = over[step] as ((i: AiInput<S>) => AiOutput<S>) | undefined;
      const res = await inner.runWithMeta(step, input);
      return { ...res, output: fn ? fn(input) : res.output, model: models[step] ?? res.model };
    },
  };
}

async function simulate(router: ReturnType<typeof fakeRouter>, questions = 3) {
  const inst = instrument(router);
  const sim = await runSimulation({ persona: kim, ai: inst.ai, maxQuestions: questions, mode: "mock" });
  return { inst, sim };
}

describe("mannerOf", () => {
  it("берёт раздел «Манера речи» персонажа", () => {
    expect(mannerOf(kim)).toMatch(/Ну, значит/);
    expect(mannerOf(kim)).not.toMatch(/## Биография/);
    expect(mannerOf({ markdown: "# X\n\n## Другое\nтекст" })).toBe("Манера речи не описана.");
  });
});

describe("evaluateRun", () => {
  it("mock: судья, обратный перевод и сказка — по одному вызову, голос 3 → цель не проверяется", async () => {
    const { inst, sim } = await simulate(fakeRouter());
    const m = await evaluateRun({ sim, ai: inst.ai, models: inst.models, mock: true });
    expect(m.chapterQuality.length).toBeGreaterThan(0);
    expect(m.voiceAvg).toBe(3);
    expect(inst.steps().judge?.calls).toBe(1);
    expect(inst.steps().back_translate?.calls).toBe(1);
    expect(inst.steps().tale?.calls).toBe(1);
    expect(m.aiCalls).toBe(sim.aiCalls.used + 3);
    expect(m.tale?.pages.length).toBeGreaterThan(0);
    expect(m.sameModel).toBe(false);

    const s = summarize([m], { mode: "mock" });
    expect(s.totals.voiceOk).toBeNull();
    const md = renderEvalReport(s);
    expect(md).toContain(MOCK_NOTE);
    expect(md).toContain("в mock не проверяется");
  });

  it("флажки KR и оценки судьи попадают в метрики; та же модель перевода — предупреждение", async () => {
    const router = fakeRouter(
      {
        judge: (i) => ({ scores: i.chapters.map((c) => ({ id: c.id, voice: 5, comment: "голос на месте" })) }),
        back_translate: (i) => ({
          chapters: i.chapters.map((c, n) => ({
            id: c.id,
            back_ru: "обратно",
            meaning: n === 0 ? 2 : 5,
            flags:
              n === 0
                ? [
                    { ko: "1941년", back_ru: "в 1941 году", ru: "в 1940 году", issue: "год рождения искажён", severity: "major" as const },
                    { ko: "하였다", back_ru: "сделал", ru: "", issue: "книжный стиль", severity: "minor" as const },
                  ]
                : [],
          })),
        }),
      },
      { translate: "gemini-flash-lite", back_translate: "gemini-flash-lite" },
    );
    const { inst, sim } = await simulate(router);
    const m = await evaluateRun({ sim, ai: inst.ai, models: inst.models, mock: false });
    expect(m.voiceAvg).toBe(5);
    expect(m.krMajor).toBe(1);
    expect(m.krMinor).toBe(1);
    expect(m.sameModel).toBe(true);

    const s = summarize([m], { mode: "gemini", label: "после" });
    expect(s.totals.voiceOk).toBe(true);
    const md = renderEvalReport(s);
    expect(md).toContain("✅ достигнута");
    expect(md).toContain("год рождения искажён");
    expect(md).toContain("той же моделью");
    expect(md).not.toContain(MOCK_NOTE);
  });

  it("#103: правила корейского без ИИ — скобки, глоссарий, стиль — в метриках, отчёте и «до / после»", async () => {
    const glossary = parseGlossary(readFileSync("docs/glossary.md", "utf8"));
    const bad = "우리는 아파디 우리(아버지의 집)에서 살았다. 손주들아, 들어 봐요.";
    const router = fakeRouter({ translate: () => ({ text_ko: bad, title_ko: "집", quote_ko: "" }) });
    const { inst, sim } = await simulate(router);
    const m = await evaluateRun({ sim, ai: inst.ai, models: inst.models, mock: true, glossary });
    const chapters = m.chapterQuality.length;
    expect(chapters).toBeGreaterThan(0);
    expect(m.krRules?.paren).toBe(chapters);
    expect(m.krRules?.style).toBe(chapters);
    const after = summarize([m], { mode: "mock", label: "PR" });
    expect(after.totals.krParen).toBe(chapters);

    // «до» без правил (старый отчёт) — «—», а не 0
    const before = summarize([{ ...m, krRules: undefined }], { mode: "mock", label: "main" });
    expect(before.totals.krParen).toBeNull();
    const c = renderPrComment(after, before);
    expect(c).toMatch(/KR без ИИ: пояснения в скобках, которых нет в оригинале \| — \| \d+ \| — \|/);
    expect(c).toContain("우리(아버지의 집)");
    expect(renderEvalReport(after)).toContain("## Корейский: правила без ИИ");

    // без глоссария правила не считаются
    const m0 = await evaluateRun({ sim, ai: inst.ai, models: inst.models, mock: true });
    expect(m0.krRules).toBeNull();
  });

  it("#157: кириллица в корейском — своя строка «KR без ИИ», а не «прочее»", () => {
    const glossary = parseGlossary(readFileSync("docs/glossary.md", "utf8"));
    expect(krRuleKind("cyrillic")).toBe("cyrillic");
    const r = checkKrRules([{ id: "c1", title: "Аппади", text_ru: "Отец, Пётр Санхович, был строгим.", text_ko: "아버지 Пётр Санхович는 엄격하셨다." }], glossary);
    expect(r.cyrillic).toBe(1);
    expect(r.other).toBe(0);
  });

  it("#157: строка «KR без ИИ: кириллица в корейском» в «до / после»", async () => {
    const glossary = parseGlossary(readFileSync("docs/glossary.md", "utf8"));
    const router = fakeRouter({ translate: () => ({ text_ko: "우리 아버지 Пётр는 엄격하셨다.", title_ko: "아버지", quote_ko: "" }) });
    const { inst, sim } = await simulate(router);
    const m = await evaluateRun({ sim, ai: inst.ai, models: inst.models, mock: true, glossary });
    // #197: sim, как конвейер, чинит кириллицу после translate (fixCyrillic) — «Пётр» в KR не остаётся
    expect(m.krRules?.cyrillic).toBe(0);
    expect(sim.chapters.some((c) => (c.text_ko ?? "").includes("표트르"))).toBe(true);
    const after = summarize([m], { mode: "mock", label: "PR" });
    expect(after.totals.krCyrillic).toBe(m.krRules?.cyrillic ?? 0);
    const before = summarize([{ ...m, krRules: undefined }], { mode: "mock", label: "main" });
    expect(before.totals.krCyrillic).toBeNull();
    expect(renderPrComment(after, before)).toMatch(/KR без ИИ: кириллица в корейском \| — \| \d+ \| — \|/);
  });

  it("судья недоступен — прогон не падает, ошибка в отчёте", async () => {
    const router = fakeRouter();
    const { inst, sim } = await simulate(router);
    const failing = {
      async run<S extends AiStep>(step: S, input: AiInput<S>): Promise<AiOutput<S>> {
        if (step === "judge") {
          const { AiUnavailableError } = await import("@/lib/ai/types");
          throw new AiUnavailableError("judge", [{ provider: "gemini", model: "x", reason: "429" }]);
        }
        return inst.ai.run(step, input);
      },
    };
    const m = await evaluateRun({ sim, ai: failing, mock: false });
    expect(m.voiceAvg).toBeNull();
    expect(m.errors.join()).toMatch(/судья/);
    expect(summarize([m], { mode: "gemini" }).totals.voiceOk).toBeNull();
  });
});

describe("#288 #198 #282: голос kk, глоссарий судьи KR, банк по пакетам", () => {
  it("#288: рассказ по-казахски (kuljamal) — голос не судим и не считаем в среднем, пометка в отчёте", async () => {
    const kuljamal = loadPersona("kuljamal");
    const seen: string[] = [];
    const router = fakeRouter({
      judge: (i) => {
        seen.push(...i.chapters.map((c) => c.id));
        return { scores: i.chapters.map((c) => ({ id: c.id, voice: 2, comment: "чужой язык" })) };
      },
    });
    const inst = instrument(router);
    const sim = await runSimulation({ persona: kuljamal, ai: inst.ai, maxQuestions: 2, mode: "mock" });
    expect(sim.chapters.some((c) => c.original === "kk")).toBe(true);
    const m = await evaluateRun({ sim, ai: inst.ai, models: inst.models, mock: false });
    expect(seen).toEqual([]);
    expect(inst.steps().judge).toBeUndefined();
    expect(m.voiceAvg).toBeNull();
    expect(m.voiceSkipped).toBe(m.chapterQuality.length);
    expect(m.chapterQuality.every((c) => c.voice === null && c.voiceComment === VOICE_KK_SKIPPED)).toBe(true);
    const s = summarize([m], { mode: "gemini" });
    expect(s.totals.voiceSkipped).toBe(m.voiceSkipped);
    expect(renderEvalReport(s)).toMatch(/голос по kk не судим, #288/);
    expect(renderEvalReport(s)).toMatch(/kk: \d+ не суд\./);
  });

  it("#288: kim (рассказ по-русски) — судья как раньше, без пометки", async () => {
    const { inst, sim } = await simulate(fakeRouter());
    const m = await evaluateRun({ sim, ai: inst.ai, models: inst.models, mock: true });
    expect(m.voiceSkipped).toBeUndefined();
    expect(renderEvalReport(summarize([m], { mode: "mock" }))).not.toMatch(/#288/);
  });

  it("#198: флажок «аппади → 아버지» снят и посчитан; год — остаётся", async () => {
    const glossary = parseGlossary(readFileSync("docs/glossary.md", "utf8"));
    const router = fakeRouter({
      back_translate: (i) => ({
        chapters: i.chapters.map((c) => ({
          id: c.id,
          back_ru: "обратно",
          meaning: 5,
          flags: [
            { ko: "아버지", back_ru: "отец", ru: "аппади", issue: "слово корё мар заменено на стандартный корейский", severity: "minor" as const },
            { ko: "1941년", back_ru: "1941", ru: "1940", issue: "год искажён", severity: "major" as const },
          ],
        })),
      }),
    });
    const { inst, sim } = await simulate(router);
    const m = await evaluateRun({ sim, ai: inst.ai, models: inst.models, mock: false, glossary });
    const n = m.chapterQuality.length;
    expect(m.krMinor).toBe(0);
    expect(m.krMajor).toBe(n);
    expect(m.krGlossaryOk).toBe(n);
    const md = renderEvalReport(summarize([m], { mode: "gemini" }));
    expect(md).toMatch(/Снято флажков «корё мар → эквивалент глоссария».*: \d+/);
    expect(krRuleKind("style:bieup")).toBe("style");
  });

  it("#282: galina — банк general, строка «чужие реалии» в итоге; kim — «—»", async () => {
    const galina = loadPersona("galina");
    const inst = instrument(fakeRouter());
    const sim = await runSimulation({ persona: galina, ai: inst.ai, maxQuestions: 2, mode: "mock" });
    const m = await evaluateRun({ sim, ai: inst.ai, models: inst.models, mock: true });
    expect(m.packs).toEqual(["general"]);
    expect(m.dialogue.foreignRealia).toBeDefined();
    const s = summarize([m], { mode: "mock" });
    expect(s.totals.foreignRealia).toBe(m.dialogue.foreignRealia!.length);
    expect(renderEvalReport(s)).toContain("Чужие реалии (#282)");
    expect(renderEvalReport(s)).toContain("galina · general");

    const k = await simulate(fakeRouter());
    const mk = await evaluateRun({ sim: k.sim, ai: k.inst.ai, models: k.inst.models, mock: true });
    expect(summarize([mk], { mode: "mock" }).totals.foreignRealia).toBeNull();
  });
});

describe("до / после", () => {
  it("комментарий в PR: маркер, таблица и Δ с направлением", async () => {
    const { inst, sim } = await simulate(fakeRouter());
    const m = await evaluateRun({ sim, ai: inst.ai, models: inst.models, mock: true });
    const before = summarize([m], { mode: "mock", label: "main" });
    const after = summarize([{ ...m, facts: { ...m.facts, lost: m.facts.lost + 2 } }], { mode: "mock", label: "PR" });
    const c = renderPrComment(after, before, { link: "https://example.test/run" });
    expect(c.startsWith(COMMENT_MARKER)).toBe(true);
    expect(c).toContain("| Метрика | До (main) | После (PR) | Δ |");
    expect(c).toMatch(/Факты потеряны \| \d+ \| \d+ \| \+2 🔴/);
    expect(c).toContain("артефакт запуска");
  });

  it("delta: рост голоса — хорошо, рост потерь — плохо", () => {
    expect(delta(3.5, 4, "up")).toBe("+0.50 🟢");
    expect(delta(1, 3, "down")).toBe("+2 🔴");
    expect(delta(2, 2, "down")).toBe("=");
    expect(delta(null, 2, "up")).toBe("—");
    expect(VOICE_TARGET).toBe(4);
  });
});

describe("instrument", () => {
  it("держит паузу между настоящими вызовами и один раз повторяет после 429", async () => {
    const { AiUnavailableError } = await import("@/lib/ai/types");
    let now = 0;
    const sleeps: number[] = [];
    let calls = 0;
    const router = {
      async runWithMeta<S extends AiStep>(step: S): Promise<RunResult<S>> {
        calls += 1;
        if (calls === 2) throw new AiUnavailableError(step, [{ provider: "gemini", model: "m", reason: "rate_limited: HTTP 429" }]);
        return { output: { answer: "да" } as never, provider: "gemini", model: "m", cached: false, attempts: [] };
      },
    };
    const inst = instrument(router, {
      clock: () => now,
      minIntervalMs: 4500,
      retryAfterMs: 30_000,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    });
    const input = { persona: "p", question: "q", history: [] };
    await inst.ai.run("persona_reply", input);
    now += 1000;
    await inst.ai.run("persona_reply", input);
    expect(sleeps).toEqual([3500, 30_000]);
    expect(calls).toBe(3);
    expect(inst.steps().persona_reply?.calls).toBe(2);
  });
});

describe("evalRoute", () => {
  const prod = [
    { provider: "gemini" as const, model: "gemini-3-flash-lite", daily_limit: 500, threshold: 0.9 },
    { provider: "gemini" as const, model: "gemini-3-flash", daily_limit: 20, threshold: 0.9 },
    { provider: "openai" as const, model: "gpt-5.4-mini" },
  ];
  it("обычные шаги — только Flash-Lite, без порогов", () => {
    expect(evalRoute("translate", prod).providers).toEqual([{ provider: "gemini", model: "gemini-3-flash-lite" }]);
    expect(evalRoute("edit", prod, "gemini-x").providers).toEqual([{ provider: "gemini", model: "gemini-x" }]);
  });
  it("back_translate — другая модель первой (Flash), Flash-Lite только запасной", () => {
    const r = evalRoute("back_translate", [prod[1]!, prod[2]!, prod[0]!], "gemini-x");
    expect(r.providers.map((p) => p.model)).toEqual(["gemini-3-flash", "gpt-5.4-mini", "gemini-3-flash-lite"]);
    expect(evalRoute("back_translate", null).providers[0]!.model).toMatch(/flash(?!-lite)/);
  });
  it("#276: обратный перевод kk → ru (translate) — модели своего провайдера, не Flash-Lite прямого перевода", () => {
    expect(evalRoute("translate", prod, undefined, "openai").providers).toEqual([{ provider: "openai", model: "gpt-5.4-mini" }]);
    // в прод-маршруте нет OpenAI — модель из lib/ai/config.ts, а не пустой список («ИИ недоступен»)
    const fromConfig = evalRoute("translate", [prod[0]!], undefined, "openai").providers;
    expect(fromConfig.length).toBeGreaterThan(0);
    expect(fromConfig.every((p) => p.provider === "openai")).toBe(true);
    expect(evalRoute("translate", prod, "gemini-x", "gemini").providers.map((p) => p.model)).toEqual(["gemini-3-flash", "gemini-3-flash-lite"]);
  });
  it("#317: persona_reply — Flash-Lite, запасной Flash прода (ответ не JSON → сразу Flash); остальные шаги — как были", () => {
    const flash = evalFlash({ edit: prod });
    expect(flash).toEqual({ provider: "gemini", model: "gemini-3-flash" });
    expect(evalRoute("persona_reply", [prod[0]!, prod[2]!], undefined, undefined, flash).providers.map((p) => p.model)).toEqual(["gemini-3-flash-lite", "gemini-3-flash"]);
    expect(evalRoute("translate", prod, undefined, undefined, flash).providers).toEqual([{ provider: "gemini", model: "gemini-3-flash-lite" }]);
    expect(evalRoute("edit", prod, "gemini-x", undefined, flash).providers).toEqual([{ provider: "gemini", model: "gemini-x" }]);
    // нет прод-маршрутов — Flash из lib/ai/config.ts
    expect(evalFlash({})?.model).toMatch(/flash(?!-lite)/);
  });
  it("нет строк judge / back_translate в проде — модели берутся из translate прода", () => {
    const d = deriveEvalSteps({ translate: prod });
    expect(d.judge).toEqual(prod);
    expect(d.back_translate!.map((p) => p.model)).toEqual(["gemini-3-flash", "gpt-5.4-mini", "gemini-3-flash-lite"]);
    const own = [{ provider: "gemini" as const, model: "own" }];
    expect(deriveEvalSteps({ translate: prod, judge: own }).judge).toEqual(own);
    expect(deriveEvalSteps({})).toEqual({});
  });
});
