// #102: словарь семьи (family_entities) и сверка расшифровки — на примерах из книги Влада.
import { describe, expect, it } from "vitest";
import { createRouter } from "@/lib/ai/router";
import { MemoryStore } from "@/lib/ai/store";
import type { AiInput, AiOutput, AiStep } from "@/lib/ai/types";
import { nameHints, reconcileNames } from "@/lib/interview/names";
import type { FamilyEntity, Story } from "@/lib/types";
import { createPipeline } from "./engine";
import { entitiesForEdit, entitiesFromChapter, mergeEntities, namesForTranslate, sameEntity } from "./entities";
import { MemoryPipelineRepo } from "./repo";

const ent = (over: Partial<FamilyEntity>): FamilyEntity => ({
  id: "e1",
  family_id: "fam-1",
  kind: "person",
  name_ru: "Олег",
  name_ko: null,
  description: null,
  story_ids: ["s1"],
  source: "auto",
  updated_at: "2026-11-24T10:00:00Z",
  ...over,
});

describe("словарь семьи из главы", () => {
  it("люди и места из facts (с «и» и запятыми), слова корё мар из текста; даты и события — нет", () => {
    const d = entitiesFromChapter({
      text_ru: "Апа Сауле приносила пигоди, а мама делала кочжан. Кочан капусты рубили во дворе.",
      facts: [
        { type: "person", value: "Олег и Лена", relation: "соседи" },
        { type: "person", value: "Сауле", relation: "соседка" },
        { type: "place", value: "Иссык-Куль" },
        { type: "date", value: "1964" },
        { type: "event", value: "буран" },
      ],
    });
    expect(d).toEqual([
      { kind: "person", name_ru: "Олег", description: null },
      { kind: "person", name_ru: "Лена", description: null },
      { kind: "person", name_ru: "Сауле", description: "соседка" },
      { kind: "place", name_ru: "Иссык-Куль", description: null },
      { kind: "word", name_ru: "пигоди", description: null },
      { kind: "word", name_ru: "кочжан", description: null },
    ]);
  });

  it("одна запись на имя в разных падежах; правка семьи не перезаписывается", () => {
    expect(sameEntity("Лена", "Лены")).toBe(true);
    expect(sameEntity("Олег", "Ольга")).toBe(false);
    expect(sameEntity("Тен", "Тена")).toBe(false); // короткие — только точное совпадение
    const existing = [ent({ id: "a", name_ru: "Олег", source: "family", description: "друг" }), ent({ id: "b", name_ru: "Лена", story_ids: ["s1"] })];
    const ch = mergeEntities(
      existing,
      [
        { kind: "person", name_ru: "Олега", description: "сосед" },
        { kind: "person", name_ru: "Лена", description: "жена Олега" },
        { kind: "place", name_ru: "Уштобе", description: null },
        { kind: "place", name_ru: "уштобе", description: null },
      ],
      "fam-1",
      "s2",
    );
    expect(ch.updates).toEqual([
      { id: "a", patch: { story_ids: ["s1", "s2"] } }, // family: только глава, описание не трогаем
      { id: "b", patch: { story_ids: ["s1", "s2"], description: "жена Олега" } },
    ]);
    expect(ch.inserts.map((i) => [i.name_ru, i.source, i.story_ids])).toEqual([["Уштобе", "auto", ["s2"]]]);
  });

  it("подсказки: правка семьи и частые — первыми; перевод — только с корейским написанием", () => {
    const list = [
      ent({ id: "1", name_ru: "Лена", story_ids: ["s1"] }),
      ent({ id: "2", name_ru: "Олег", story_ids: ["s1", "s2", "s3"], name_ko: "올레그" }),
      ent({ id: "3", name_ru: "Сауле", source: "family", description: "соседка, апа" }),
    ];
    expect(entitiesForEdit(list).map((e) => e.name)).toEqual(["Сауле", "Олег", "Лена"]);
    expect(entitiesForEdit(list)[0]).toEqual({ kind: "person", name: "Сауле", about: "соседка, апа" });
    expect(namesForTranslate(list)).toEqual([{ ru: "Олег", ko: "올레그" }]);
    const hints = nameHints({ storytellerName: "Ни Валентина", entities: ["Сауле", "Олег", "Лена"] });
    expect(hints.slice(0, 4)).toEqual(["Ни Валентина", "Сауле", "Олег", "Лена"]);
    expect(hints.indexOf("пигоди")).toBeLessThan(45); // корё мар доходит до моделей расшифровки (берут первые 45–60)
  });
});

describe("сверка расшифровки со словарём (примеры из #102)", () => {
  const hints = nameHints({ storytellerName: "Ни Валентина", entities: ["Олег", "Лена", "апа Сауле", "Сауле", "Иссык-Куль", "Тен", "Ни"] });
  it.each([
    ["Соседка опаса уле принесла пирожки.", "Соседка апа Сауле принесла пирожки."],
    ["Летом ездили на Иссык Куль.", "Летом ездили на Иссык-Куль."],
    ["Мы жили в Уштабе, потом в У штабе.", "Мы жили в Уштобе, потом в Уштобе."],
    ["Кугси варили по субботам.", "Кукси варили по субботам."],
  ])("«%s» → «%s»", (heard, fixed) => expect(reconcileNames(heard, hints).text).toBe(fixed));

  it.each([
    "Мы бегали на арык, погоди, расскажу.", // «бегали», «погоди» ≠ «пигоди»
    "Купили кочан капусты и морковку.", // русские слова, похожие на корё мар
    "Мы жили в Караганде, потом в Уштобе.", // правильное слово в другом падеже
    "Лина пришла с Ольгой.", // другие, похожие имена не подменяем
    "Мама Тен, папа Ни.", // короткие фамилии — только подсказки расшифровке
  ])("не трогает: «%s»", (s) => expect(reconcileNames(s, hints).text).toBe(s));
});

describe("конвейер: словарь пополняется главой и подсказывает следующей", () => {
  it("после главы 1 — Олег и Лена в словаре; глава 2: в hints расшифровки, в entities редактуры, в names перевода", async () => {
    const router = createRouter({ store: new MemoryStore(), mode: () => "mock" });
    const calls: { step: AiStep; input: Record<string, unknown> }[] = [];
    let editFacts: { type: "person" | "place"; value: string; relation?: string }[] = [{ type: "person", value: "Олег и Лена", relation: "соседи" }];
    const ai = {
      async run<S extends AiStep>(step: S, input: AiInput<S>, o?: Parameters<typeof router.run>[2]): Promise<AiOutput<S>> {
        calls.push({ step, input: input as Record<string, unknown> });
        if (step === "edit") return { text_ru: "Олег и Лена жили рядом.", title: "Соседи", quote: "", facts: editFacts } as AiOutput<S>;
        return router.run(step, input, o);
      },
    };
    const repo = new MemoryPipelineRepo();
    repo.audio.set("a.webm", { data: Buffer.from("x") });
    const pipeline = createPipeline({ ai, repo });
    const base = { family_id: "fam-1", storyteller_id: "st-1", session_id: null, parent_story_id: null, question_id: null, block: null, duration_sec: null, text_ru: null, text_ko: null, title: null, title_ko: null, quote: null, quote_ko: null, facts: [], followups: [], status: "uploaded" as const, error: null, sort_order: null, created_at: "2026-11-24T10:00:00Z", updated_at: "2026-11-24T10:00:00Z" } satisfies Omit<Story, "id" | "audio_url" | "transcript">;
    repo.add({ ...base, id: "s1", audio_url: null, transcript: "Соседи у нас были Олег и Лена." });
    await pipeline.processStory("s1");
    expect(repo.entities.map((e) => [e.kind, e.name_ru, e.story_ids])).toEqual([
      ["person", "Олег", ["s1"]],
      ["person", "Лена", ["s1"]],
    ]);

    // семья поправила корейское написание (#104) — перевод следующей главы его получает
    repo.entities[0]!.name_ko = "올레그";
    repo.entities[0]!.source = "family";
    editFacts = [{ type: "person", value: "Олега", relation: "сосед" }];
    repo.add({ ...base, id: "s2", audio_url: "a.webm", transcript: null, created_at: "2026-11-24T11:00:00Z" });
    await pipeline.processStory("s2");
    const tr = calls.filter((c) => c.step === "transcribe").at(-1)!.input;
    expect((tr.hints as string[]).slice(0, 2)).toEqual(["Олег", "Лена"]);
    const ed = calls.filter((c) => c.step === "edit").at(-1)!.input;
    expect(ed.entities).toEqual([
      { kind: "person", name: "Олег" },
      { kind: "person", name: "Лена" },
    ]);
    const tl = calls.filter((c) => c.step === "translate").at(-1)!.input;
    expect(tl.names).toEqual([{ ru: "Олег", ko: "올레그" }]);
    // «Олега» — та же запись: дописана глава, имя семьи не тронуто
    expect(repo.entities[0]).toMatchObject({ name_ru: "Олег", name_ko: "올레그", source: "family", story_ids: ["s1", "s2"] });
    expect(repo.entities).toHaveLength(2);
  });

  it("сбой записи словаря не роняет главу", async () => {
    const router = createRouter({ store: new MemoryStore(), mode: () => "mock" });
    const repo = new MemoryPipelineRepo();
    repo.saveEntities = async () => {
      throw new Error("permission denied for table family_entities");
    };
    const pipeline = createPipeline({ ai: router, repo });
    repo.add({ id: "s1", family_id: "fam-1", storyteller_id: "st-1", session_id: null, parent_story_id: null, question_id: null, block: null, audio_url: null, duration_sec: null, transcript: "Жили в Уштобе.", text_ru: null, text_ko: null, title: null, title_ko: null, quote: null, quote_ko: null, facts: [], followups: [], status: "uploaded", error: null, sort_order: null, created_at: "2026-11-24T10:00:00Z", updated_at: "2026-11-24T10:00:00Z" });
    const r = await pipeline.processStory("s1");
    expect(r).toMatchObject({ status: "ready", done: true });
  });
});
