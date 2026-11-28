// #352: банк проверок — чистая логика, сид, прогон боевым конвейером в mock (без ключей и базы).
import { describe, expect, it } from "vitest";
import { createRouter } from "@/lib/ai/router";
import { MemoryStore } from "@/lib/ai/store";
import { inputSchemas, outputSchemas } from "@/lib/ai/types";
import { mockOutput } from "@/lib/ai/providers/mock";
import {
  avgRating,
  bucketOf,
  cleanFocus,
  cleanTags,
  generateCalls,
  personaMarkdown,
  seedUuid,
  tagCounts,
  tagsForCall,
  validateManualText,
  wordCount,
} from "./core";
import { generateBank } from "./generate";
import { MemoryQualityRepo } from "./repo";
import { QualityBudgetError, guardedAi, runPersona, runText, trackingStore } from "./run";
import { loadSeedFiles, promptVersions, seedRows } from "./seed";
import { EMPTY_COUNTERS, NUANCE_TAGS, START_PAIRS, type QualityPersona, type QualityText } from "./types";

const files = loadSeedFiles();
const rows = seedRows(files);

describe("сид банка (§1: 5 личностей и ≈ 20 текстов на пару, по 2–3 текста на тег)", () => {
  it.each(START_PAIRS)("%s: 5 личностей, 18–22 текста, каждый тег — главный у 2–3 текстов", (pair) => {
    const ps = rows.personas.filter((p) => p.pair === pair);
    const ts = rows.texts.filter((t) => t.pair === pair);
    expect(ps).toHaveLength(5);
    expect(ts.length).toBeGreaterThanOrEqual(18);
    expect(ts.length).toBeLessThanOrEqual(22);
    for (const tag of NUANCE_TAGS) {
      const n = ts.filter((t) => t.nuance_tags[0] === tag).length;
      expect(n, `${pair} ${tag}`).toBeGreaterThanOrEqual(2);
      expect(n, `${pair} ${tag}`).toBeLessThanOrEqual(3);
    }
  });

  it("тексты 100–250 слов, теги известные, фокус-слова есть в тексте (3–8), у каждого — личность своей пары", () => {
    const raw = files.flatMap((f) => f.texts.map((t) => ({ ...t, pair: f.pair })));
    for (const t of raw) {
      expect(wordCount(t.text), t.key).toBeGreaterThanOrEqual(100);
      expect(wordCount(t.text), t.key).toBeLessThanOrEqual(250);
      expect(cleanTags(t.nuance_tags), t.key).toEqual(t.nuance_tags);
      expect(cleanFocus(t.focus_terms, t.text), t.key).toEqual(t.focus_terms);
      expect(t.focus_terms.length, t.key).toBeGreaterThanOrEqual(3);
    }
    const byId = new Map(rows.personas.map((p) => [p.id, p]));
    for (const t of rows.texts) expect(byId.get(t.persona_id!)?.pair, t.seed_key!).toBe(t.pair);
  });

  it("все eval-персонажи — в банке как source=seed; ключи и id сида стабильны, без повторов", () => {
    const evalKeys = rows.personas.filter((p) => p.seed_key?.startsWith("eval:")).map((p) => p.seed_key!.split(":")[1]);
    expect(new Set(evalKeys)).toEqual(new Set(["kim", "pak", "tsoi", "serik", "galina", "kuljamal"]));
    for (const p of rows.personas) {
      expect(p.source).toBe("seed");
      expect(p.id).toBe(seedUuid(p.seed_key!));
    }
    const keys = [...rows.personas, ...rows.texts].map((r) => r.seed_key);
    expect(new Set(keys).size).toBe(keys.length);
    // eval-персонаж без «Ключевых фактов»: эталон для проверки не уходит в persona_reply
    expect(rows.personas.find((p) => p.seed_key === "eval:kim:ru-ko")!.bio).not.toMatch(/Ключевые факты/);
  });

  it("только вымышленные: в каждом eval-персонаже и сиде нет «реальной семьи», у новых — без ссылок и телефонов", () => {
    for (const p of rows.personas) expect(p.bio).not.toMatch(/https?:|@|\+7\s?\d/);
    for (const t of rows.texts) expect(t.text_src).not.toMatch(/https?:|@|\+7\s?\d/);
  });

  it("повторный сид ничего не дублирует и не трогает статус архива", async () => {
    const repo = new MemoryQualityRepo();
    expect(await repo.upsertSeed(rows.personas, rows.texts)).toEqual({ personas: rows.personas.length, texts: rows.texts.length });
    const first = (await repo.texts("ru-kk"))[0]!;
    await repo.setStatus("text", [first.id], "archived");
    expect(await repo.upsertSeed(rows.personas, rows.texts)).toEqual({ personas: 0, texts: 0 });
    expect((await repo.texts("ru-kk")).find((t) => t.id === first.id)!.status).toBe("archived");
  });
});

describe("логика банка", () => {
  it("колонки: архив > проверены > в проверке > новые", () => {
    expect(bucketOf("archived", { ...EMPTY_COUNTERS, reviewed: 3 })).toBe("archived");
    expect(bucketOf("active", { ...EMPTY_COUNTERS, links: 1, reviewed: 1 })).toBe("reviewed");
    expect(bucketOf("active", { ...EMPTY_COUNTERS, links: 2 })).toBe("review");
    expect(bucketOf("active", { ...EMPTY_COUNTERS, runs: 4 })).toBe("new");
  });

  it("«Сгенерировать N»: ≤ 6, по 2 на вызов; без тегов — самые редкие в банке по кругу", () => {
    expect(generateCalls(5)).toEqual([2, 2, 1]);
    expect(generateCalls(40)).toEqual([2, 2, 2]);
    expect(generateCalls(0)).toEqual([1]);
    expect(tagsForCall(["idioms"], {}, 3)).toEqual(["idioms"]);
    const counts = tagCounts([
      { nuance_tags: ["kinship", "dates"], status: "active" },
      { nuance_tags: ["kinship"], status: "new" },
      { nuance_tags: ["idioms"], status: "archived" },
    ]);
    expect(counts).toEqual({ kinship: 2, dates: 1 });
    expect(tagsForCall([], counts, 0)).toEqual(["grandkids"]);
  });

  it("средняя оценка: числа 1–5 из ratings и criteria, пропущенные не считаем", () => {
    expect(avgRating([{ ratings: { meaning: 4, grammar: 5 } }, { criteria: { natural: 3 } }, { ratings: { meaning: 1 }, skipped: true }])).toBe(4);
    expect(avgRating([])).toBeNull();
  });

  it("ручной текст: 40–400 слов и хотя бы один тег", () => {
    expect(validateManualText({ text_src: "коротко", tags: ["kinship"] })).toMatch(/короткий/);
    expect(validateManualText({ text_src: "слово ".repeat(120), tags: [] })).toMatch(/тег/);
    expect(validateManualText({ text_src: "слово ".repeat(120), tags: ["kinship"] })).toBeNull();
  });

  it("markdown личности: eval — как есть; новая — заголовок, книга пары, пакеты, манера речи", () => {
    const md = personaMarkdown({ name: "Тестова Анна", pair: "ru-kk", pack: "kz", bio: "Родилась в 1950 году.", speech_style: "Говорит медленно." });
    expect(md).toMatch(/^# Тестова Анна/);
    expect(md).toContain("книга: `ru,kk` · пакеты: `general` + `kz`");
    expect(md).toContain("## Манера речи\nГоворит медленно.");
    expect(personaMarkdown({ name: "x", pair: "ru-ko", pack: "koryo", bio: "# Ким\n\nтекст", speech_style: "" })).toBe("# Ким\n\nтекст");
  });

  it("версия промптов — хэш каждого файла prompts/*.md, включая quality_generate.md", () => {
    const v = promptVersions();
    expect(v["translate.kk.md"]).toMatch(/^[0-9a-f]{12}$/);
    expect(v["quality_generate.md"]).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("quality_generate: контракт и заглушка", () => {
  it("личность и текст по контракту; разный variant — разные события", () => {
    const p = outputSchemas.quality_generate.parse(mockOutput("quality_generate", inputSchemas.quality_generate.parse({ kind: "persona", pair: "ru-ko", count: 2 })));
    expect(p.personas).toHaveLength(2);
    const a = outputSchemas.quality_generate.parse(mockOutput("quality_generate", inputSchemas.quality_generate.parse({ kind: "text", pair: "ru-kk", variant: 0 })));
    const b = outputSchemas.quality_generate.parse(mockOutput("quality_generate", inputSchemas.quality_generate.parse({ kind: "text", pair: "ru-kk", variant: 1 })));
    expect(a.texts[0]!.event).not.toBe(b.texts[0]!.event);
    expect(outputSchemas.quality_generate.safeParse({ personas: [], texts: [] }).success).toBe(false);
  });
});

function mockRouter() {
  const tracked = trackingStore(new MemoryStore());
  const router = createRouter({ store: tracked.store, mode: () => "mock" });
  return { tracked, router };
}

const persona = (seedKey: string) => {
  const p = rows.personas.find((x) => x.seed_key === seedKey)!;
  return { ...p, status: "active", seed_key: p.seed_key ?? null, created_at: "" } as QualityPersona;
};
const text = (pair: string) => {
  const t = rows.texts.find((x) => x.pair === pair)!;
  return { ...t, status: "active", seed_key: t.seed_key ?? null, created_at: "" } as QualityText;
};

describe("прогон боевым конвейером (mock)", () => {
  it("текст ru → kk и ru → ko: один item с переводом, фокус-слова — к проверяющему", async () => {
    const { router, tracked } = mockRouter();
    const kk = await runText(text("ru-kk"), "ru-kk", router);
    expect(kk.status).toBe("ok");
    expect(kk.items).toHaveLength(1);
    expect(kk.items[0]).toMatchObject({ lang_from: "ru", lang_to: "kk", step: "translate" });
    expect(kk.items[0]!.focus_terms.length).toBeGreaterThan(0);
    const ko = await runText(text("ru-ko"), "ru-ko", router);
    expect(ko.items[0]).toMatchObject({ lang_from: "ru", lang_to: "ko" });
    expect(tracked.used().translate).toEqual(["mock/mock"]);
  });

  it("личность ru → kk: интервью → главы → казахский перевод", async () => {
    const { router } = mockRouter();
    const out = await runPersona(persona("seed:ru-kk:aigul"), "ru-kk", router, { maxQuestions: 2, maxCalls: 40 });
    expect(out.items.length).toBeGreaterThan(0);
    expect(out.items.every((i) => i.lang_to === "kk" && i.out_text.length > 0)).toBe(true);
    expect(["ok", "partial"]).toContain(out.status);
  });

  it("лимит $: вызов не начинается, если уже потрачено ≥ лимита; текст → budget", async () => {
    const { router } = mockRouter();
    const ai = guardedAi(router, () => 2.5, 2);
    await expect(ai.run("translate", { text_ru: "т", title: "", quote: "" })).rejects.toBeInstanceOf(QualityBudgetError);
    const out = await runText(text("ru-kk"), "ru-kk", ai);
    expect(out.status).toBe("budget");
    expect(out.items).toEqual([]);
  });
});

describe("«Сгенерировать N» (mock)", () => {
  it("тексты от лица личностей пары, статус new, source generated; без личностей — понятная ошибка", async () => {
    const { router } = mockRouter();
    const repo = new MemoryQualityRepo();
    const empty = await generateBank(repo, router, { kind: "text", pair: "ru-kk", n: 3, tags: [] });
    expect(empty.added).toBe(0);
    expect(empty.errors[0]).toMatch(/нет активных личностей/);

    const p = await generateBank(repo, router, { kind: "persona", pair: "ru-kk", n: 3, tags: ["kinship"] });
    expect(p).toMatchObject({ added: 3, failed: 0 });
    await repo.setStatus("persona", [(await repo.personas("ru-kk"))[0]!.id], "archived");
    const t = await generateBank(repo, router, { kind: "text", pair: "ru-kk", n: 5, tags: ["dates"] });
    expect(t).toMatchObject({ added: 5, failed: 0 });
    const texts = await repo.texts("ru-kk");
    const live = new Set((await repo.personas("ru-kk")).filter((x) => x.status !== "archived").map((x) => x.id));
    expect(texts.every((x) => x.status === "new" && x.source === "generated" && live.has(x.persona_id!))).toBe(true);
    expect(texts.every((x) => x.nuance_tags[0] === "dates" && x.focus_terms.length > 0)).toBe(true);
  });
});
