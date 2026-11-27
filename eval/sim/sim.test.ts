// Симулятор интервью (I15) — всё в mock: роутер с заглушкой и MemoryStore, без ключей и базы.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createRouter } from "@/lib/ai/router";
import { MemoryStore } from "@/lib/ai/store";
import { AiUnavailableError, type AiInput, type AiOutput, type AiStep } from "@/lib/ai/types";
import { MAX_FOLLOWUPS } from "@/lib/interview/policy";
import { SimBudgetError, withBudget } from "./budget";
import { checkFact, checkFacts, splitFacts, stems } from "./facts";
import { BEHAVIORS, listPersonas, loadPersona, parsePacks, parsePersona, resolveBehavior } from "./persona";
import { bankForPacks, getQuestionBank } from "@/lib/interview/bank";
import { renderReport, reportFileName, writeReport } from "./report";
import { runSimulation } from "./run";

type Override = { [S in AiStep]?: (input: AiInput<S>, n: number) => AiOutput<S> | undefined };

const LONG = `Родился я в Уштобе, в сороковом году. Отец был бригадиром в колхозе, мама вела дом и пела нам по вечерам.
  Помню запах риса на току, как мы с братом бегали к арыку и как отец привёз с базара первый велосипед. `.repeat(2);

function mockAi(override: Override = {}) {
  const router = createRouter({ store: new MemoryStore(), mode: () => "mock" });
  const counts: Partial<Record<AiStep, number>> = {};
  return {
    async run<S extends AiStep>(step: S, input: AiInput<S>): Promise<AiOutput<S>> {
      const n = (counts[step] = (counts[step] ?? 0) + 1);
      const fn = override[step] as ((i: AiInput<S>, n: number) => AiOutput<S> | undefined) | undefined;
      return fn?.(input, n) ?? router.run(step, input);
    },
  };
}

const kim = loadPersona("kim");

describe("персонажи", () => {
  it("все персонажи из eval/personas читаются и содержат эталон фактов", () => {
    const keys = listPersonas();
    expect(keys).toEqual(expect.arrayContaining(["kim", "pak", "tsoi"]));
    for (const k of keys) {
      const p = loadPersona(k);
      expect(p.keyFacts.length).toBeGreaterThan(0);
      expect(p.markdown).not.toMatch(/Ключевые факты/);
      expect(p.defaultBehaviors.every((b) => (BEHAVIORS as readonly string[]).includes(b))).toBe(true);
    }
  });

  it("разбирает kim.md: имя, профили по умолчанию, факты", () => {
    expect(kim.name).toBe("Ким Николай Петрович");
    expect(kim.defaultBehaviors).toEqual(["koryo-mar", "confuses-dates"]);
    expect(kim.keyFacts[0]).toBe("1940 — родился в Уштобе");
    expect(kim.markdown).toMatch(/## Биография по блокам/);
  });

  it("--behavior переопределяет профиль; неизвестный профиль — ошибка", () => {
    expect(resolveBehavior(kim)).toBe("koryo-mar, confuses-dates");
    expect(resolveBehavior(kim, "one-word")).toBe("one-word");
    expect(() => resolveBehavior(kim, "shouts")).toThrow(/Неизвестный профиль/);
    expect(() => loadPersona("../secret")).toThrow();
  });

  it("раздел фактов не последний — остальное сохраняется", () => {
    const p = parsePersona("x", "# Икс (x)\n\n## Ключевые факты\n- 1950 — родился\n\n## Не хочет говорить\n- о войне\n");
    expect(p.keyFacts).toEqual(["1950 — родился"]);
    expect(p.markdown).toMatch(/Не хочет говорить/);
  });
});

describe("сверка фактов", () => {
  it("found / distorted / lost", () => {
    const text = "Я родился в 1940 году в Уштобе. В 1978 году мне дали медаль за новый сорт риса.";
    expect(checkFact("1940 — родился в Уштобе", text).status).toBe("found");
    expect(checkFact("1979 — медаль за сорт риса", text)).toMatchObject({ status: "distorted", detail: "1979 → 1978" });
    expect(checkFact("жена Тен Галина, познакомились в 1963 году на танцах", text).status).toBe("lost");
  });

  it("год соседнего эталонного факта — не искажение", () => {
    const text = "Родители переселены в 1937 году в Уштобе.";
    const [born] = checkFacts(["1940 — родился в Уштобе", "1937 — переселение родителей"], text);
    expect(born!.status).toBe("lost");
  });

  it("падежи не мешают, строки с «;» делятся", () => {
    expect(stems("Уштобе")).toEqual(["уштоб"]);
    expect(checkFact("окончил сельхозинститут", "Потом я окончил сельхозинститут в Алма-Ате").status).toBe("found");
    expect(splitFacts(["1957 — окончил школу; 1958–1962 — сельхозинститут"])).toHaveLength(2);
  });
});

describe("лимит запросов", () => {
  it("не пускает вызов сверх лимита", async () => {
    const b = withBudget(mockAi(), 1);
    await b.ai.run("next_question", { storytellerName: "", coveredBlocks: [], recentAnswers: [], candidateQuestions: [{ id: "a", block: "roots", text: "?" }] });
    await expect(
      b.ai.run("next_question", { storytellerName: "", coveredBlocks: [], recentAnswers: [], candidateQuestions: [{ id: "a", block: "roots", text: "?" }] }),
    ).rejects.toBeInstanceOf(SimBudgetError);
    expect(b.used()).toBe(1);
    expect(b.byStep()).toEqual({ next_question: 1 });
  });
});

describe("симуляция", () => {
  it("kim: интервью → уточнения → главы RU/KR → отчёт", async () => {
    const r = await runSimulation({ persona: kim, behavior: resolveBehavior(kim), ai: mockAi() });
    expect(r.stoppedBy).toBeNull();
    expect(r.questions.length).toBeGreaterThan(0);
    expect(r.questions.every((q) => q.followups <= MAX_FOLLOWUPS)).toBe(true);
    expect(r.questions.some((q) => q.followups > 0)).toBe(true);
    expect(r.chapters.length).toBeGreaterThan(0);
    expect(r.chapters.every((c) => c.text_ru && c.text_ko && !c.error)).toBe(true);
    expect(r.aiCalls.byStep.persona_reply).toBeGreaterThan(0);
    expect(r.aiCalls.byStep.completeness).toBeGreaterThan(0);
    expect(r.aiCalls.byStep.edit).toBe(r.chapters.length);
    expect(r.aiCalls.byStep.translate).toBe(r.chapters.length);
    expect(r.factsInChapters).toHaveLength(splitFacts(kim.keyFacts).length);

    const md = renderReport(r);
    for (const h of ["## Итог", "## Уточнения по вопросам", "## Ключевые факты", "## Главы", "## Диалог", "**RU**", "**KR"]) {
      expect(md).toContain(h);
    }
  });

  it.each(BEHAVIORS)("профиль %s запускается до конца", async (behavior) => {
    const r = await runSimulation({ persona: kim, behavior, ai: mockAi() });
    expect(r.stoppedBy).toBeNull();
    expect(r.turns.filter((t) => t.role === "persona").length).toBeGreaterThan(0);
  });

  it("refuses: все вопросы пропущены без уточнений, глав нет", async () => {
    const r = await runSimulation({ persona: kim, behavior: "refuses", ai: mockAi() });
    expect(r.questions.every((q) => q.outcome === "skipped" && q.followups === 0)).toBe(true);
    expect(r.chapters).toHaveLength(0);
    expect(renderReport(r)).toMatch(/Глав нет/);
  });

  it("wanders: рассказ не по теме уходит в свой блок и становится отдельной главой", async () => {
    const ai = mockAi({
      completeness: (i, n) =>
        n === 1 ? { covered: [], missing: i.minimum, followup: null, done: false, offTopicBlock: "work" } : undefined,
    });
    const r = await runSimulation({ persona: kim, behavior: "wanders", ai, maxQuestions: 2 });
    expect(r.questions[0]!.outcome).toBe("answered");
    expect(r.turns.some((t) => t.role === "followup" && t.text.startsWith("Какая история!"))).toBe(true);
    expect(r.chapters.some((c) => c.questionId === null && c.block === "work")).toBe(true);
  });

  it("emotional: тёплая пауза, без уточнений подряд", async () => {
    const ai = mockAi({ persona_reply: (_, n) => (n === 1 ? { answer: "Мама… (плачет) простите, сейчас." } : undefined) });
    const r = await runSimulation({ persona: kim, behavior: "emotional", ai, maxQuestions: 2 });
    expect(r.turns.some((t) => t.role === "note" && t.text === "(тёплая пауза)")).toBe(true);
    expect(r.questions[0]).toMatchObject({ followups: 0, outcome: "later" });
  });

  it("--questions N останавливает после N вопросов", async () => {
    const r = await runSimulation({ persona: kim, ai: mockAi(), maxQuestions: 2 });
    expect(r.questions).toHaveLength(2);
    expect(r.stoppedBy).toBe("questions");
  });

  it("лимит запросов: интервью останавливается, главы всё равно собраны", async () => {
    const r = await runSimulation({ persona: kim, ai: mockAi(), maxCalls: 30 });
    expect(r.stoppedBy).toBe("budget");
    expect(r.aiCalls.used).toBeLessThanOrEqual(30);
    expect(r.chapters.length).toBeGreaterThan(0);
    expect(r.chapters.every((c) => !c.error)).toBe(true);
  });
});

describe("#275: режим «меньше вызовов» и повтор persona_reply", () => {
  const counter = () => {
    const n: Partial<Record<AiStep, number>> = {};
    const inner = mockAi({ persona_reply: () => ({ answer: LONG }) });
    return {
      n,
      ai: {
        async run<S extends AiStep>(step: S, input: AiInput<S>): Promise<AiOutput<S>> {
          n[step] = (n[step] ?? 0) + 1;
          return inner.run(step, input);
        },
      },
    };
  };

  it("--fewer-calls: completeness без отдельного next_question; без опции — как в проде", async () => {
    const off = counter();
    await runSimulation({ persona: kim, ai: off.ai, maxQuestions: 2 });
    expect(off.n.next_question ?? 0).toBeGreaterThan(0);
    const on = counter();
    await runSimulation({ persona: kim, ai: on.ai, maxQuestions: 2, fewerCalls: true });
    expect(on.n.completeness ?? 0).toBeGreaterThan(0);
    expect(on.n.next_question ?? 0).toBeLessThan(off.n.next_question!);
  });

  it("persona_reply не JSON → один повтор, интервью идёт дальше", async () => {
    const inner = mockAi();
    let fails = 0;
    const ai = {
      async run<S extends AiStep>(step: S, input: AiInput<S>): Promise<AiOutput<S>> {
        if (step === "persona_reply" && fails === 0) {
          fails++;
          throw new AiUnavailableError("persona_reply", [{ provider: "gemini", model: "gemini-3.5-flash-lite", reason: "bad_output: ответ не JSON" }]);
        }
        return inner.run(step, input);
      },
    };
    const r = await runSimulation({ persona: kim, ai, maxQuestions: 2 });
    expect(r.stoppedBy).toBe("questions");
    expect(r.turns.some((t) => t.role === "note" && t.text.includes("повтор"))).toBe(true);
    expect(r.chapters.length).toBeGreaterThan(0);
  });
});

describe("отчёт", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sim-report-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("пишет eval/reports/<persona>-<дата>[-<профиль>].md", async () => {
    const r = await runSimulation({ persona: kim, ai: mockAi(), maxQuestions: 1, now: () => new Date("2026-11-23T10:00:00Z") });
    expect(reportFileName(r)).toBe("kim-2026-11-23.md");
    const file = writeReport(r, { dir, explicitBehavior: "long" });
    expect(path.basename(file)).toBe("kim-2026-11-23-long.md");
    expect(readFileSync(file, "utf8")).toMatch(/^# Симуляция интервью: Ким Николай Петрович/);
  });
});

describe("#282: банк по пакетам персонажа", () => {
  it("строка «пакеты:» → packs; планы в скобках не берём; без строки — undefined (банк V0)", () => {
    expect(loadPersona("galina").packs).toEqual(["general"]);
    expect(loadPersona("kuljamal").packs).toEqual(["general", "kz"]);
    expect(loadPersona("serik").packs).toEqual(["general", "kz"]);
    for (const k of ["kim", "pak", "tsoi"]) expect(loadPersona(k).packs, k).toBeUndefined();
    expect(parsePacks("- Язык: `ru` · пакеты: `general` (позже + `ua`)")).toEqual(["general"]);
  });

  it("galina (general): вопросы — из банка general, без корё-реалий; kim — банк V0, как раньше", async () => {
    const galina = loadPersona("galina");
    const r = await runSimulation({ persona: galina, ai: mockAi(), maxQuestions: 3 });
    const general = bankForPacks(["general"]);
    expect(r.questions.length).toBeGreaterThan(0);
    for (const q of r.questions) expect(general.get(q.id)?.ru, q.id).toBe(q.text);
    expect(r.questions.map((q) => q.text).join(" ")).not.toMatch(/корё|корейск|кукси|чимчи|хальмони/i);

    const v0 = getQuestionBank();
    const k = await runSimulation({ persona: kim, ai: mockAi(), maxQuestions: 3 });
    for (const q of k.questions) expect(v0.get(q.id)?.ru, q.id).toBe(q.text);
  });
});
