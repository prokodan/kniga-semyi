// #354 (v2 Q3): разбор отзывов → находки → предложение правки только в разрешённых файлах.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AiRouter } from "@/lib/ai/router";
import { mockOutput } from "@/lib/ai/providers/mock";
import { inputSchemas, outputSchemas } from "@/lib/ai/types";
import { parseGolden } from "@/eval/reviews/format";
import { runDigest } from "./digest";
import { MemoryDigestRepo } from "./digest-repo";
import { buildUnit, diffExcerpt, fingerprint, planMerge, type QualityFinding, type RawUnit } from "./findings";
import {
  CHECK_MARKER,
  KZ_GLOSSARY_FILE,
  KZ_GLOSSARY_MARKER,
  PROMPT_RULES_HEADER,
  PatchRefusedError,
  addPromptRules,
  assertAllowedPatch,
  changedPaths,
  isAllowedPatchPath,
  planProposal,
  proposalBody,
} from "./propose";

let aiCalls = 0;
const mockAi: Pick<AiRouter, "run"> = {
  async run(step, input) {
    aiCalls += 1;
    const parsed = inputSchemas[step].parse(input);
    return outputSchemas[step].parse(mockOutput(step, parsed as never)) as never;
  },
};

const SRC = ["Апам каждое воскресенье пекла баурсаки.", "Мой старший брат Ерболат возил нас в школу.", "Внуки мои, не забывайте корни."].join("\n\n");
const OUT = ["Әжеміз әр жексенбі сайын бауырсақ пісіретін.", "Менің інім Ерболат бізді мектепке апаратын.", "Немерелерім, тамырларыңызды ұмытпаңыздар."].join("\n\n");
const FIX = ["Апам әр жексенбі сайын бауырсақ пісіретін.", "Менің ағам Ерболат бізді мектепке апаратын.", "Немерелерім, тамырларыңды ұмытпаңдар."];

let n = 0;
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

function unit(opts: { edits?: number[]; at?: string; comment?: string; terms?: Record<string, { ok: boolean; fix?: string }> } = {}): RawUnit {
  const item = uid();
  const at = opts.at ?? "2026-11-28T10:00:00.000Z";
  return {
    link: { id: uid(), pair: "ru-kk", reviewer_label: "А. К." },
    item: { id: item, kind: "chapter", title: "Апа и баурсаки", source_text: SRC, model_text: OUT, persona: "bank:aigul", prompt_version: "translate.kk abc123", focus_terms: [{ term: "әже", hint: "апа" }] },
    feedback: [
      ...(opts.edits ?? []).map((p) => ({ id: uid(), paragraph: p, edited_text: FIX[p]!, ratings: {}, comment: null, skipped: false, terms: {}, updated_at: at })),
      { id: uid(), paragraph: -1, edited_text: null, ratings: { meaning: 3, respect: 2 }, comment: opts.comment ?? null, skipped: false, terms: opts.terms ?? {}, updated_at: at },
    ],
  };
}

describe("quality-digest: отзыв → единица разбора", () => {
  it("правки абзацев (только настоящие), «неверно → как правильно», оценки, комментарий", () => {
    const u = buildUnit(unit({ edits: [0, 1], comment: "апа — это мама", terms: { "0": { ok: false, fix: "апа" } } }))!;
    expect(u.edits.map((e) => e.paragraph)).toEqual([0, 1]);
    expect(u.edits[0]).toMatchObject({ source: SRC.split("\n\n")[0], before: OUT.split("\n\n")[0], after: FIX[0] });
    expect(u.terms).toEqual([expect.objectContaining({ term: "әже", hint: "апа", fix: "апа" })]);
    expect(u.ratings).toEqual({ meaning: 3, respect: 2 });
    expect(u.comment).toBe("апа — это мама");
  });

  it("одни оценки без замечаний, правка = перевод модели, вопросы банка — разбирать нечего", () => {
    expect(buildUnit(unit())).toBeNull();
    const same = unit({ edits: [0] });
    same.feedback[0]!.edited_text = ` ${OUT.split("\n\n")[0]}  `;
    expect(buildUnit(same)).toBeNull();
    const q = unit({ edits: [0] });
    q.item.kind = "question";
    expect(buildUnit(q)).toBeNull();
  });
});

describe("quality-digest: находки, дубли, лимит, авто-предложение", () => {
  it("ссылка с 3 правками → 3 находки; повторный разбор ничего не дублирует", async () => {
    const repo = new MemoryDigestRepo();
    repo.addUnit(unit({ edits: [0, 1, 2] }));
    const r = await runDigest({ repo, ai: mockAi, trigger: "link" });
    expect(r).toMatchObject({ status: "ok", itemsAnalyzed: 1, findingsNew: 3, calls: 1 });
    const fs = await repo.findings({ pair: "ru-kk" });
    expect(fs).toHaveLength(3);
    for (const f of fs) {
      expect(f.component).toBe("prompt");
      expect(f.evidence[0]).toMatchObject({ kind: "edit", reviewer: "А. К." });
      expect(f.evidence[0]!.source).toBeTruthy();
      expect(f.feedback_id).toBeTruthy();
    }
    const again = await runDigest({ repo, ai: mockAi, trigger: "cron" });
    expect(again.status).toBe("idle");
    expect(await repo.findings()).toHaveLength(3);
    expect(repo.digestRows.map((d) => d.status)).toEqual(["ok", "idle"]);
  });

  it("та же ошибка в другом тексте → слита: count 2, оба текста и отзыва; изменился отзыв — разбор заново", async () => {
    const repo = new MemoryDigestRepo();
    const a = unit({ edits: [0] });
    repo.addUnit(a);
    await runDigest({ repo, ai: mockAi, trigger: "cron" });
    repo.addUnit(unit({ edits: [0] }));
    const r = await runDigest({ repo, ai: mockAi, trigger: "cron" });
    expect(r).toMatchObject({ findingsNew: 0, findingsMerged: 1 });
    const [f] = await repo.findings();
    expect(f!.count).toBe(2);
    expect(f!.item_ids).toHaveLength(2);
    expect(f!.feedback_ids).toHaveLength(2);
    // проверяющий поправил тот же текст ещё раз — текст разбирается снова, но count не растёт (тот же текст)
    a.feedback[0]!.updated_at = "2026-11-28T12:00:00.000Z";
    const r2 = await runDigest({ repo, ai: mockAi, trigger: "cron" });
    expect(r2.itemsAnalyzed).toBe(1);
    expect((await repo.findings())[0]!.count).toBe(2);
  });

  it("лимит $ на сутки исчерпан — ИИ не зовём, тексты не отмечаем", async () => {
    const repo = new MemoryDigestRepo();
    repo.addUnit(unit({ edits: [0] }));
    repo.spent = 3.01;
    const before = aiCalls;
    const r = await runDigest({ repo, ai: mockAi, trigger: "cron", dailyUsd: 3 });
    expect(r.status).toBe("budget");
    expect(aiCalls).toBe(before);
    expect(repo.seenRows.size).toBe(0);
  });

  it("ИИ недоступен — partial, тексты разберём в следующий раз", async () => {
    const repo = new MemoryDigestRepo();
    repo.addUnit(unit({ edits: [0] }));
    const r = await runDigest({ repo, ai: { run: async () => Promise.reject(new Error("ИИ недоступен")) }, trigger: "cron" });
    expect(r.status).toBe("partial");
    expect(repo.seenRows.size).toBe(0);
  });

  it("≥ 3 новых находок одного компонента → quality-propose запускается сам; второй разбор одновременно — busy", async () => {
    const repo = new MemoryDigestRepo();
    repo.addUnit(unit({ edits: [0, 1, 2] }));
    const dispatch = vi.fn(async () => undefined);
    const r = await runDigest({ repo, ai: mockAi, trigger: "link", dispatchPropose: dispatch });
    expect(dispatch).toHaveBeenCalledWith("ru-kk", "prompt");
    expect(r.proposed).toEqual([{ pair: "ru-kk", component: "prompt", count: 3 }]);
    await repo.startDigest("cron");
    expect((await runDigest({ repo, ai: mockAi, trigger: "cron" })).status).toBe("busy");
  });

  it("пример длинного абзаца — только изменённые слова и немного вокруг", () => {
    const long = `${"слово ".repeat(60)}конец`;
    const d = diffExcerpt(long, `${long} түзету`, 2);
    expect(d.after).toBe("… слово конец түзету");
    expect(d.before).toBe("… слово конец");
    expect(diffExcerpt("коротко", "кратко")).toEqual({ before: "коротко", after: "кратко" });
  });

  it("duplicate_of — только находка той же пары и компонента; отпечаток не зависит от регистра и кавычек", () => {
    expect(fingerprint("glossary", { src: "", wrong: "«Әже»", right: "апа." }, "")).toBe(fingerprint("glossary", { src: "", wrong: "әже", right: "Апа" }, "x"));
    const ex = { id: "f1", pair: "ru-ko", component: "prompt", fingerprint: "prompt:a→b", item_ids: ["x"], feedback_ids: [], link_ids: [], evidence: [], severity: "minor", fix: { kind: "none", rule: "", src: "", wrong: "", right: "" } } as unknown as QualityFinding;
    const draft = { feedback_id: null, feedback_ids: [], item_ids: ["y"], link_ids: [], pair: "ru-kk", component: "prompt" as const, severity: "minor" as const, summary: "s", evidence: [], fix: ex.fix, fingerprint: "prompt:c→d", count: 1, digest_id: null };
    const plan = planMerge([ex], [{ draft, duplicateOf: "f1" }]);
    expect(plan.create).toHaveLength(1);
    expect(plan.update).toHaveLength(0);
  });
});

// ---------------- предложение правки ----------------

const read = (p: string) => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
};

function finding(over: Partial<QualityFinding>): QualityFinding {
  return {
    id: uid(),
    feedback_id: null,
    feedback_ids: [uid()],
    item_ids: [uid()],
    link_ids: [uid()],
    pair: "ru-kk",
    component: "prompt",
    severity: "major",
    summary: "Апа рассказчика переведена как әже — должно остаться апа",
    evidence: [
      {
        kind: "edit",
        before: OUT.split("\n\n")[0]!,
        after: FIX[0]!,
        source: SRC.split("\n\n")[0]!,
        paragraph: 0,
        item_id: "i",
        link_id: "l",
        feedback_id: "fb",
        reviewer: "А. К.",
        reviewed_at: "2026-11-28T10:00:00.000Z",
        persona: "bank:aigul",
        title: "Апа",
        prompt_version: "translate.kk abc",
      },
    ],
    fix: { kind: "prompt_rule", rule: "«Апам» рассказчика переводите «апам», не «әжеміз».", src: "", wrong: "Әжеміз", right: "Апам" },
    fingerprint: "x",
    count: 1,
    status: "new",
    proposal_id: null,
    digest_id: null,
    created_at: "2026-11-28T10:00:00.000Z",
    updated_at: "2026-11-28T10:00:00.000Z",
    ...over,
  };
}

describe("quality-propose: патч только в разрешённых файлах", () => {
  it("разрешено: translate.<язык>.md, content/packs/*, kk-check, kr-check, золотой набор; остальное — нет", () => {
    for (const p of ["prompts/translate.kk.md", "prompts/translate.ko.md", "content/packs/kz/glossary.ts", "content/packs/koryo/pack.ts", "eval/kk-check.ts", "eval/kr-check.ts", "eval/golden/ru-kk.jsonl"])
      expect(isAllowedPatchPath(p), p).toBe(true);
    for (const p of [
      "lib/pipeline/kk.ts",
      "lib/ai/config.ts",
      "supabase/migrations/x.sql",
      "prompts/edit.md",
      "prompts/translate.md",
      "prompts/quality_analyze.md",
      "content/packs/kz/glossary.test.ts",
      "eval/golden/../../lib/ai/config.ts",
      "/etc/passwd",
      "./prompts/translate.kk.md",
      "eval/golden/ru-kk.json",
      ".github/workflows/ci.yml",
      "docs/glossary.md",
    ])
      expect(isAllowedPatchPath(p), p).toBe(false);
  });

  it("пути из git status -z: ведущий пробел статуса не съедает букву; переименование — оба пути", () => {
    const z = " M content/packs/kz/glossary.ts\0M  prompts/translate.kk.md\0?? eval/golden/ru-kk.jsonl\0R  lib/x.ts\0prompts/old.md\0";
    expect(changedPaths(z)).toEqual(["content/packs/kz/glossary.ts", "prompts/translate.kk.md", "eval/golden/ru-kk.jsonl", "lib/x.ts", "prompts/old.md"]);
    expect(() => assertAllowedPatch(changedPaths(z))).toThrow(/lib\/x\.ts/);
  });

  it("патч вне разрешённых файлов → отказ (PatchRefusedError)", () => {
    expect(() => assertAllowedPatch(["prompts/translate.kk.md", "lib/pipeline/kk.ts"])).toThrow(PatchRefusedError);
    expect(() => assertAllowedPatch(["eval/golden/ru-kk.jsonl"])).not.toThrow();
  });

  it("ru-kk: правило в промпт, термин в глоссарий kz (+ строка промпта), правило kk-check, правки → золотой набор", () => {
    const fs = [
      finding({}),
      finding({ component: "glossary", summary: "Жена старшего брата — жеңге", fix: { kind: "glossary", rule: "", src: "золовка-тест", wrong: "жеңгей", right: "тестжеңге" } }),
      finding({ component: "check_rule", summary: "«-ңыздар» к внукам", fix: { kind: "check_rule", rule: "к внукам — сендер", src: "", wrong: "ұмытпаңыздар", right: "ұмытпаңдар" } }),
    ];
    const plan = planProposal({ pair: "ru-kk", findings: fs, read });
    expect(Object.keys(plan.files).sort()).toEqual(["content/packs/kz/glossary.ts", "eval/golden/ru-kk.jsonl", "eval/kk-check.ts", "prompts/translate.kk.md"]);
    const prompt = plan.files["prompts/translate.kk.md"]!;
    expect(prompt).toContain(PROMPT_RULES_HEADER);
    expect(prompt).toContain("- «Апам» рассказчика переводите «апам», не «әжеміз».");
    // каждое казахское слово глоссария есть в промпте (тест content/packs/kz/glossary.test.ts)
    expect(plan.files[KZ_GLOSSARY_FILE]).toContain('kk: "тестжеңге"');
    expect(prompt).toContain("тестжеңге");
    expect(plan.files[KZ_GLOSSARY_FILE]).toContain(KZ_GLOSSARY_MARKER);
    expect(plan.files["eval/kk-check.ts"]).toContain('{ wrong: "ұмытпаңыздар", right: "ұмытпаңдар"');
    expect(plan.files["eval/kk-check.ts"]).toContain(CHECK_MARKER);
    // правила — перед «title — …», остальной промпт не тронут
    expect(prompt.indexOf(PROMPT_RULES_HEADER)).toBeLessThan(prompt.indexOf("title — перевод заголовка"));
    expect(prompt.replace(/\nПравила из отзывов[^\n]*\n(- [^\n]*\n)+\n/, "\n")).toBe(read("prompts/translate.kk.md"));
    const golden = parseGolden(plan.files["eval/golden/ru-kk.jsonl"]!);
    expect(golden.at(-1)).toMatchObject({ pair: "ru-kk", kind: "chapter", source: SRC.split("\n\n")[0], model: OUT.split("\n\n")[0], gold: FIX[0], reviewer: "А. К." });
    expect(plan.goldenAdded).toBe(1);
    expect(plan.issues).toEqual([]);
    for (const p of Object.keys(plan.files)) expect(isAllowedPatchPath(p)).toBe(true);
  });

  it("маршрут модели и код — только issue, не патч; повтор того же правила не дублирует строку промпта", () => {
    const route = finding({ component: "model_route", evidence: [], fix: { kind: "route", rule: "модель обрывает текст", src: "", wrong: "", right: "" } });
    const plan = planProposal({ pair: "ru-kk", findings: [route], read });
    expect(plan.files).toEqual({});
    expect(plan.issues).toHaveLength(1);
    expect(plan.issues[0]!.title).toContain("Маршрут модели ru-kk");
    const once = addPromptRules(read("prompts/translate.kk.md")!, ["Правило А."]);
    const twice = addPromptRules(once.text, ["Правило А.", "Правило Б."]);
    expect(twice.added).toEqual(["Правило Б."]);
    expect(twice.text.split(PROMPT_RULES_HEADER)).toHaveLength(2);
    expect(twice.text).toMatch(/- Правило А\.\n- Правило Б\.\n/);
  });

  it("ru-ko: глоссарий корейского (docs/glossary.md) вне списка → строкой в translate.ko.md; описание PR — «Флаг:» один раз, предупреждение RU + KR", () => {
    const f = finding({
      pair: "ru-ko",
      component: "glossary",
      summary: "старший брат сестры — 오빠",
      evidence: [],
      fix: { kind: "glossary", rule: "", src: "старший брат", wrong: "형", right: "오빠" },
    });
    const plan = planProposal({ pair: "ru-ko", findings: [f], read });
    expect(Object.keys(plan.files)).toEqual(["prompts/translate.ko.md"]);
    expect(plan.files["prompts/translate.ko.md"]).toContain("- Глоссарий: «старший брат» → 오빠 (не «형»).");
    expect(plan.files["prompts/translate.ko.md"]!.indexOf(PROMPT_RULES_HEADER)).toBeLessThan(plan.files["prompts/translate.ko.md"]!.indexOf("title_ko —"));
    const body = proposalBody({ plan, findings: [f], proposalId: "p1", issues: [] });
    expect(body.match(/^Флаг:/gm)).toEqual(["Флаг:"]);
    expect(body).toContain("Флаг: не нужен — правка промпта / глоссария через eval");
    expect(body).toContain("RU + KR");
    expect(body).toContain("Какие отзывы → что меняем");
  });
});
