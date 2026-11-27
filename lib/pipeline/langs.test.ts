// #231: перевод главы по языкам книги семьи (флаг lang_kk). Конвейер в AI_MODE=mock, хранилище в памяти.
import { describe, expect, it } from "vitest";
import { createRouter } from "@/lib/ai/router";
import { MemoryStore } from "@/lib/ai/store";
import type { AiInput, AiStep } from "@/lib/ai/types";
import type { Story } from "@/lib/types";
import translateFixture from "@/fixtures/ai/translate.json";
import translateKk from "@/fixtures/ai/translate.kk.json";
import { createPipeline, nextStep } from "./engine";
import { choiceOf, effectiveBookLangs, pendingTranslations, translationTargets } from "./langs";
import { MemoryPipelineRepo } from "./repo";

function story(over: Partial<Story> = {}): Story {
  const now = new Date().toISOString();
  return {
    id: "s-1",
    family_id: "fam-kk",
    storyteller_id: "st-1",
    session_id: null,
    parent_story_id: null,
    question_id: "childhood-01",
    block: "childhood",
    audio_url: null,
    duration_sec: null,
    transcript: "Я родился в 1940 году в Уштобе. Отец работал в колхозе, мы сажали рис.",
    text_ru: null,
    text_ko: null,
    title: null,
    title_ko: null,
    quote: null,
    quote_ko: null,
    facts: [],
    followups: [],
    status: "uploaded",
    error: null,
    sort_order: null,
    created_at: now,
    updated_at: now,
    ...over,
  };
}

function setup(langs?: ("ru" | "ko" | "kk")[], kkOn = true) {
  const router = createRouter({ store: new MemoryStore(), mode: () => "mock" });
  const calls: { step: AiStep; input: AiInput<AiStep> }[] = [];
  const ai = {
    run: (async (step: AiStep, input: AiInput<AiStep>, o?: Parameters<typeof router.run>[2]) => {
      calls.push({ step, input });
      return router.run(step, input as never, o);
    }) as typeof router.run,
  };
  const repo = new MemoryPipelineRepo();
  if (langs) repo.bookLangs.set("fam-kk", langs);
  repo.langKkOn = kkOn;
  repo.add(story());
  return { pipeline: createPipeline({ ai, repo }), repo, calls };
}

describe("языки книги (#231)", () => {
  it("чистые функции: флаг выключен — kk в book_langs не действует; цели и недостающие переводы", () => {
    expect(effectiveBookLangs({ book_langs: ["ru", "kk"] }, true)).toEqual(["ru", "kk"]);
    expect(effectiveBookLangs({ book_langs: ["ru", "kk"] }, false)).toEqual(["ru", "ko"]);
    expect(effectiveBookLangs({ book_langs: ["ru"] }, false)).toEqual(["ru"]);
    expect(effectiveBookLangs(null, true)).toEqual(["ru", "ko"]);
    expect(translationTargets(["ru", "kk"])).toEqual(["kk"]);
    expect(pendingTranslations(["ru", "ko"], { text_ko: null }, [])).toEqual(["ko"]);
    expect(pendingTranslations(["ru", "ko"], { text_ko: "글" }, [])).toEqual([]);
    expect(pendingTranslations(["ru", "kk"], { text_ko: null }, ["kk"])).toEqual([]);
    expect(nextStep({ transcript: "t", text_ru: "r", text_ko: null, parent_story_id: null, pending_langs: [] })).toBeNull();
    expect(nextStep({ transcript: "t", text_ru: "r", text_ko: null, parent_story_id: null })).toBe("translate");
    expect(choiceOf(["ru", "kk"])).toBe("ru,kk");
    expect(choiceOf(["kk", "ru"])).toBeNull();
  });

  it("книга ru,kk: глава переводится на казахский (translate.kk.md), корейского нет", async () => {
    const { pipeline, repo, calls } = setup(["ru", "kk"]);
    const res = await pipeline.processStory("s-1");
    expect(res.status).toBe("ready");
    const tr = calls.filter((c) => c.step === "translate");
    expect(tr).toHaveLength(1);
    expect(tr[0]!.input).toMatchObject({ from: "ru", to: "kk" });
    const kk = repo.texts.get("s-1")!.find((r) => r.lang === "kk");
    expect(kk).toMatchObject({ title: translateKk.title, text: translateKk.text, quote: translateKk.quote });
    expect((await repo.getStory("s-1"))!.text_ko).toBeNull();
  });

  it("книга ru,ko (по умолчанию) и флаг выключен — как сейчас: перевод на корейский без пары во входе", async () => {
    for (const s of [setup(), setup(["ru", "kk"], false)]) {
      await s.pipeline.processStory("s-1");
      const tr = s.calls.filter((c) => c.step === "translate");
      expect(tr).toHaveLength(1);
      expect(tr[0]!.input).not.toHaveProperty("to");
      expect((await s.repo.getStory("s-1"))!.text_ko).toBe(translateFixture.text_ko);
      expect(s.repo.texts.get("s-1")!.some((r) => r.lang === "kk")).toBe(false);
    }
  });

  it("книга только на русском — без перевода, глава готова", async () => {
    const { pipeline, calls } = setup(["ru"]);
    const res = await pipeline.processStory("s-1");
    expect(res.status).toBe("ready");
    expect(calls.some((c) => c.step === "translate")).toBe(false);
  });

  it("пересборка и правка русского текста — казахский перевод заново", async () => {
    const { pipeline, repo, calls } = setup(["ru", "kk"]);
    await pipeline.processStory("s-1");
    await repo.updateStory("s-1", { text_ru: "Новый текст главы." });
    expect(repo.texts.get("s-1")!.some((r) => r.lang === "kk")).toBe(false);
    await pipeline.rebuild("s-1", "translate");
    await pipeline.processStory("s-1");
    expect(repo.texts.get("s-1")!.some((r) => r.lang === "kk")).toBe(true);
    expect(calls.filter((c) => c.step === "translate")).toHaveLength(2);
  });

  it("семья переключила книгу на ru,kk — готовая глава (есть KR) догоняет казахский перевод", async () => {
    const { pipeline, repo, calls } = setup();
    await pipeline.processStory("s-1");
    repo.bookLangs.set("fam-kk", ["ru", "kk"]);
    await repo.updateStory("s-1", { status: "translating" });
    const res = await pipeline.processStory("s-1");
    expect(res.status).toBe("ready");
    expect(calls.filter((c) => c.step === "translate").map((c) => (c.input as { to?: string }).to)).toEqual([undefined, "kk"]);
    expect((await repo.getStory("s-1"))!.text_ko).toBe(translateFixture.text_ko); // корейский не стёрт
  });
});
