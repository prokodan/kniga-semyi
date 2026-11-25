// #121 #124 #134: одно имя — одно корейское написание во всей книге.
import { describe, expect, it } from "vitest";
import { createRouter } from "@/lib/ai/router";
import { MemoryStore } from "@/lib/ai/store";
import type { AiInput, AiOutput, AiStep } from "@/lib/ai/types";
import type { FamilyEntity, Story } from "@/lib/types";
import { createPipeline } from "./engine";
import { applySpellings, learnSpellings, replaceKo, requiredSpellings, validKo } from "./names";
import { MemoryPipelineRepo } from "./repo";

const ent = (over: Partial<FamilyEntity>): FamilyEntity => ({
  id: "e1",
  family_id: "fam-1",
  kind: "person",
  name_ru: "Лена",
  name_ko: null,
  description: null,
  story_ids: ["s1"],
  source: "auto",
  updated_at: "2026-11-25T10:00:00Z",
  ...over,
});

describe("написание имён: чистые функции", () => {
  it("validKo: хангыль, без кириллицы и латиницы", () => {
    expect(validKo(" 레나 ")).toBe("레나");
    expect(validKo("Лена")).toBeNull();
    expect(validKo("Lena 레나")).toBeNull();
    expect(validKo("")).toBeNull();
  });

  it("replaceKo: с начала слова, частицы остаются; часть более длинного — не трогаем", () => {
    expect(replaceKo("렌나는 웃었다. 렌나와 나는 친구였다.", "렌나", "레나")).toBe("레나는 웃었다. 레나와 나는 친구였다.");
    expect(replaceKo("마렌나", "렌나", "레나")).toBe("마렌나"); // внутри другого слова
    expect(replaceKo("안나가 왔다", "안나", "안나 페트로브나")).toBe("안나가 왔다"); // from — часть to
    expect(replaceKo("김이 왔다", "김", "킴")).toBe("김이 왔다"); // один слог — слишком рискованно
  });

  it("requiredSpellings: только люди и места с написанием; правка семьи важнее авто", () => {
    const list = [
      ent({ id: "a", name_ru: "Лена", name_ko: "렌나" }),
      ent({ id: "b", name_ru: "Лены", name_ko: "레나", source: "family" }),
      ent({ id: "c", kind: "word", name_ru: "кукси", name_ko: "국수" }),
      ent({ id: "d", kind: "place", name_ru: "Уштобе", name_ko: "우슈토베" }),
      ent({ id: "e", name_ru: "Олег", name_ko: null }),
    ];
    expect(requiredSpellings(list)).toEqual([
      { ru: "Лены", ko: "레나" },
      { ru: "Уштобе", ko: "우슈토베" },
    ]);
  });

  it("applySpellings: вариант переводчика → словарный во всех трёх полях; names в ответе — словарные", () => {
    const out = {
      text_ko: "렌나는 우스토베에서 태어났다. 렌나의 어머니는 의사였다.",
      title_ko: "렌나 이야기",
      quote_ko: "렌나의 어머니는 의사였다.",
      names: [
        { ru: "Лена", ko: "렌나" },
        { ru: "Уштобе", ko: "우스토베" },
      ],
    };
    const r = applySpellings(out, [
      { ru: "Лены", ko: "레나" },
      { ru: "Уштобе", ko: "우슈토베" },
    ]);
    expect(r.out.text_ko).toBe("레나는 우슈토베에서 태어났다. 레나의 어머니는 의사였다.");
    expect(r.out.title_ko).toBe("레나 이야기");
    expect(r.out.quote_ko).toBe("레나의 어머니는 의사였다.");
    expect(r.out.names).toEqual([
      { ru: "Лена", ko: "레나" },
      { ru: "Уштобе", ko: "우슈토베" },
    ]);
    expect(r.fixed).toEqual([
      { ru: "Лены", from: "렌나", to: "레나" },
      { ru: "Уштобе", from: "우스토베", to: "우슈토베" },
    ]);
  });

  it("applySpellings: без names в ответе или варианта нет в тексте — ничего не меняет", () => {
    const out = { text_ko: "렌나는 웃었다.", title_ko: "", quote_ko: "" };
    expect(applySpellings(out, [{ ru: "Лена", ko: "레나" }]).out).toEqual(out);
    const lying = { ...out, names: [{ ru: "Лена", ko: "엘레나" }] };
    expect(applySpellings(lying, [{ ru: "Лена", ko: "레나" }]).fixed).toEqual([]);
  });

  it("learnSpellings: только пустые написания людей и мест этой главы", () => {
    const list = [
      ent({ id: "a", name_ru: "Лена" }),
      ent({ id: "b", name_ru: "Олег", name_ko: "올레그", source: "family" }),
      ent({ id: "c", name_ru: "Сауле", story_ids: ["s0"] }), // не из этой главы
      ent({ id: "d", kind: "word", name_ru: "кукси" }),
      ent({ id: "e", kind: "place", name_ru: "Уштобе" }),
    ];
    const names = [
      { ru: "Лену", ko: "레나" },
      { ru: "Олег", ko: "올렉" },
      { ru: "Сауле", ko: "사울레" },
      { ru: "кукси", ko: "국수" },
      { ru: "Уштобе", ko: "Уштобе" }, // не хангыль — не запоминаем
    ];
    expect(learnSpellings(list, names, "s1")).toEqual([{ id: "a", name_ko: "레나" }]);
    expect(learnSpellings(list, undefined, "s1")).toEqual([]);
  });
});

describe("конвейер: одно имя — одно написание во всей книге", () => {
  const base = { family_id: "fam-1", storyteller_id: "st-1", session_id: null, parent_story_id: null, question_id: null, block: null, audio_url: null, duration_sec: null, text_ru: null, text_ko: null, title: null, title_ko: null, quote: null, quote_ko: null, facts: [], followups: [], status: "uploaded" as const, error: null, sort_order: null, created_at: "2026-11-25T10:00:00Z", updated_at: "2026-11-25T10:00:00Z" } satisfies Omit<Story, "id" | "transcript">;

  /** Переводчик пишет Лену по очереди: 렌나, потом 레나, потом 엘레나 — как разные модели в разные дни. */
  function setup(spellings: string[]) {
    const calls: { step: AiStep; input: Record<string, unknown> }[] = [];
    let n = 0;
    const router = createRouter({ store: new MemoryStore(), mode: () => "mock" });
    const ai = {
      async run<S extends AiStep>(step: S, input: AiInput<S>, o?: Parameters<typeof router.run>[2]): Promise<AiOutput<S>> {
        calls.push({ step, input: input as Record<string, unknown> });
        if (step === "edit") return { text_ru: "Лена жила в Уштобе.", title: "Лена", quote: "", facts: [{ type: "person", value: "Лена", relation: "сестра" }] } as AiOutput<S>;
        if (step === "translate") {
          const ko = spellings[Math.min(n++, spellings.length - 1)]!;
          return { text_ko: `${ko}는 우슈토베에서 살았다.`, title_ko: ko, quote_ko: "", names: [{ ru: "Лена", ko }] } as AiOutput<S>;
        }
        return router.run(step, input, o);
      },
    };
    const repo = new MemoryPipelineRepo();
    const pipeline = createPipeline({ ai, repo });
    return { calls, repo, pipeline };
  }

  it("первая глава задаёт написание, следующие получают его во входе и приводятся к нему", async () => {
    const { calls, repo, pipeline } = setup(["렌나", "레나", "엘레나"]);
    for (const [i, id] of ["s1", "s2", "s3"].entries()) {
      repo.add({ ...base, id, transcript: "Лена жила в Уштобе.", created_at: `2026-11-25T1${i}:00:00Z` });
      await pipeline.processStory(id);
    }
    expect(repo.entities.find((e) => e.name_ru === "Лена")).toMatchObject({ name_ko: "렌나", source: "auto", story_ids: ["s1", "s2", "s3"] });
    for (const id of ["s1", "s2", "s3"]) {
      const s = repo.stories.get(id)!;
      expect(s.text_ko).toBe("렌나는 우슈토베에서 살았다.");
      expect(s.title_ko).toBe("렌나");
    }
    const tl = calls.filter((c) => c.step === "translate").map((c) => c.input.names);
    expect(tl).toEqual([undefined, [{ ru: "Лена", ko: "렌나" }], [{ ru: "Лена", ko: "렌나" }]]);
  });

  it("правка семьи (#104) важнее: новый перевод берёт её написание, даже если переводчик написал иначе", async () => {
    const { repo, pipeline } = setup(["렌나"]);
    repo.entities.push({ id: "e-fam", family_id: "fam-1", kind: "person", name_ru: "Лена", name_ko: "레나", description: null, story_ids: [], source: "family", updated_at: "2026-11-25T09:00:00Z" });
    repo.add({ ...base, id: "s1", transcript: "Лена жила в Уштобе." });
    await pipeline.processStory("s1");
    expect(repo.stories.get("s1")!.text_ko).toBe("레나는 우슈토베에서 살았다.");
    expect(repo.entities).toHaveLength(1);
    expect(repo.entities[0]).toMatchObject({ name_ko: "레나", source: "family" });
  });

  it("соседняя глава успела записать своё написание раньше — эта глава приводится к нему", async () => {
    const { repo, pipeline } = setup(["렌나"]);
    const save = repo.saveSpellings.bind(repo);
    repo.saveSpellings = async (story, sp) => {
      // пока шёл перевод, соседняя глава записала 레나
      repo.entities.find((e) => e.name_ru === "Лена")!.name_ko = "레나";
      await save(story, sp);
    };
    repo.add({ ...base, id: "s1", transcript: "Лена жила в Уштобе." });
    await pipeline.processStory("s1");
    expect(repo.entities.find((e) => e.name_ru === "Лена")!.name_ko).toBe("레나");
    expect(repo.stories.get("s1")!.text_ko).toBe("레나는 우슈토베에서 살았다.");
  });

  it("сбой записи написания не роняет главу", async () => {
    const { repo, pipeline } = setup(["렌나"]);
    repo.saveSpellings = async () => {
      throw new Error("permission denied for table family_entities");
    };
    repo.add({ ...base, id: "s1", transcript: "Лена жила в Уштобе." });
    const r = await pipeline.processStory("s1");
    expect(r).toMatchObject({ status: "ready", done: true });
    expect(repo.stories.get("s1")!.text_ko).toBe("렌나는 우슈토베에서 살았다.");
  });
});
