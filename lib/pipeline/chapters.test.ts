// #98: «один записанный ответ → ровно одна глава». Сценарии из книг 24.11: ответ на уточнение, который интервью
// не дождалось (расшифровка дольше ожидания телефона), повтор одной истории в двух главах (буран 1964 / 1984),
// ответы не по порядку тем с уточнениями, отказами и переспросами.
import { describe, expect, it } from "vitest";
import { createRouter } from "@/lib/ai/router";
import { MemoryStore } from "@/lib/ai/store";
import type { AiInput, AiOutput, AiStep } from "@/lib/ai/types";
import type { Story } from "@/lib/types";
import { createPipeline, LATE_CHILD_REBUILD_MS } from "./engine";
import { MemoryPipelineRepo } from "./repo";
import { attachChildren, containment, dropRepeats, fullSource, sentences, shingles } from "./sources";

let seq = 0;
const t0 = Date.parse("2026-11-24T10:00:00Z");
function st(over: Partial<Story>): Story {
  seq += 1;
  const at = new Date(t0 + seq * 60_000).toISOString();
  return {
    id: `s${String(seq).padStart(3, "0")}`,
    family_id: "fam-1",
    storyteller_id: "st-1",
    session_id: null,
    parent_story_id: null,
    question_id: null,
    block: null,
    audio_url: null,
    duration_sec: null,
    transcript: null,
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
    created_at: at,
    updated_at: at,
    ...over,
  };
}

function setup() {
  const router = createRouter({ store: new MemoryStore(), mode: () => "mock" });
  const edits: { storyId: string; transcript: string }[] = [];
  const ai = {
    async run<S extends AiStep>(step: S, input: AiInput<S>, o?: Parameters<typeof router.run>[2]): Promise<AiOutput<S>> {
      if (step === "edit") {
        const t = (input as AiInput<"edit">).transcript;
        edits.push({ storyId: o?.storyId ?? "", transcript: t });
        // глава = источник как есть: так видно, что именно в неё попало
        return { text_ru: t, title: "Глава", quote: "", facts: [] } as AiOutput<S>;
      }
      return router.run(step, input, o);
    },
  };
  const repo = new MemoryPipelineRepo();
  repo.audio.set("a.webm", { data: Buffer.from("x") });
  const pipeline = createPipeline({ ai, repo });
  return { pipeline, repo, edits };
}

const BURAN =
  "Зимой на трассе нас накрыл буран, машины встали, мы трое суток жгли покрышки и ждали тягач из Талды-Кургана. Это был шестьдесят четвёртый год, я тогда первый год работал шофёром.";
const BURAN_AGAIN =
  "Помню, на трассе нас накрыл буран, машины встали, мы трое суток жгли покрышки и ждали тягач из Талды-Кургана. Это был восемьдесят четвёртый год.";

describe("источник главы (#98)", () => {
  it("предложения и доля совпадений", () => {
    expect(sentences("Раз. Два! Три?")).toEqual(["Раз.", "Два!", "Три?"]);
    expect(containment(shingles("а б в г"), shingles("x а б в г y"))).toBe(1);
  });

  it("запись-уточнение без отметки в followups приклеивается один раз, отказ и пустая — нет", () => {
    const { followups, added } = attachChildren(
      [{ question: "А где?", answer: "В Уштобе, у арыка." }],
      [
        { id: "c1", transcript: "В Уштобе, у арыка.", status: "ready", created_at: "2026-11-24T10:01:00Z" }, // интервью уже приклеило
        { id: "c3", transcript: "Не хочу об этом.", status: "skipped", created_at: "2026-11-24T10:03:00Z" },
        { id: "c2", transcript: "Отец работал на рисовом поле.", status: "ready", created_at: "2026-11-24T10:02:00Z" },
        { id: "c4", transcript: null, status: "transcribing", created_at: "2026-11-24T10:04:00Z" },
      ],
    );
    expect(added).toBe(1);
    expect(followups.map((f) => f.answer)).toEqual(["В Уштобе, у арыка.", "Отец работал на рисовом поле."]);
    expect(followups[1]!.story_id).toBe("c2");
    expect(attachChildren(followups, [{ id: "c2", transcript: "Отец работал на рисовом поле.", status: "ready", created_at: "" }]).added).toBe(0);
  });

  it("повтор рассказа из более ранней главы выпадает, новые предложения и короткие общие фразы остаются", () => {
    const d = dropRepeats([`Я работал шофёром. ${BURAN_AGAIN} Потом меня перевели механиком в гараж.`], [{ id: "early", source: BURAN }]);
    expect(d.parts[0]).toBe("Я работал шофёром. Потом меня перевели механиком в гараж.");
    expect(d.dropped).toBe(2); // и «Это был восемьдесят четвёртый год.» — продолжение повтора
    expect(d.repeatsOf).toEqual(["early"]);
  });
});

describe("конвейер: один ответ → одна глава (#98)", () => {
  it("ответ на уточнение, который интервью не дождалось, попадает в главу (edit приклеивает запись)", async () => {
    const { pipeline, repo, edits } = setup();
    const main = st({ question_id: "roots-01", block: "roots", transcript: "Родился я в Уштобе." });
    repo.add(main);
    repo.add(st({ parent_story_id: main.id, question_id: "roots-01", transcript: "Дом был саманный, у арыка.", status: "ready" }));
    await pipeline.processStory(main.id);
    expect(edits[0]!.transcript).toBe("Родился я в Уштобе.\n\nДом был саманный, у арыка.");
    const saved = (await repo.getStory(main.id))!;
    expect(saved.followups).toHaveLength(1);
    expect(saved.status).toBe("ready");
  });

  it("поздняя расшифровка уточнения после сборки свежей главы → глава пересобирается с ответом", async () => {
    const { pipeline, repo, edits } = setup();
    const main = st({ question_id: "roots-03", block: "roots", transcript: "Мама была строгая.", created_at: new Date(Date.now() - 10 * 60_000).toISOString() });
    repo.add(main);
    await pipeline.processStory(main.id);
    const child = st({ parent_story_id: main.id, question_id: "roots-03", audio_url: "a.webm" });
    repo.add(child);
    const r = await pipeline.processStory(child.id);
    expect(r).toMatchObject({ status: "ready", rebuildParent: main.id });
    const reset = (await repo.getStory(main.id))!;
    expect(reset).toMatchObject({ status: "editing", text_ru: null, text_ko: null });
    expect(reset.followups[0]!.story_id).toBe(child.id);
    await pipeline.processStory(main.id);
    expect(edits.at(-1)!.transcript).toContain("Мама была строгая.\n\n");
    expect((await repo.getStory(main.id))!.followups).toHaveLength(1); // не задвоилось
  });

  it("поздняя расшифровка для старой главы (семья могла править) — только приклеить, без пересборки", async () => {
    const { pipeline, repo } = setup();
    const main = st({ created_at: new Date(Date.now() - LATE_CHILD_REBUILD_MS - 3600_000).toISOString(), question_id: "roots-02", transcript: "Папа был кузнецом.", text_ru: "Папа был кузнецом.", text_ko: "…", status: "ready" });
    repo.add(main);
    const child = st({ parent_story_id: main.id, audio_url: "a.webm" });
    repo.add(child);
    const r = await pipeline.processStory(child.id);
    expect(r.rebuildParent).toBeUndefined();
    const p = (await repo.getStory(main.id))!;
    expect(p).toMatchObject({ status: "ready", text_ru: "Папа был кузнецом." });
    expect(p.followups.map((f) => f.story_id)).toEqual([child.id]);
  });

  it("одна история в двух ответах (буран) — во второй главе её нет; весь ответ — повтор → skipped, не вторая глава", async () => {
    const { pipeline, repo, edits } = setup();
    const a = st({ question_id: "work-03", block: "work", transcript: "Работал на автобазе.", followups: [{ question: "Случай?", answer: BURAN }] });
    const b = st({ question_id: "work-04", block: "work", transcript: "Потом стал механиком.", followups: [{ question: "Трудно было?", answer: BURAN_AGAIN }] });
    const c = st({ question_id: "hardship-01", block: "hardship", transcript: BURAN_AGAIN });
    for (const s of [a, b, c]) repo.add(s);
    for (const s of [a, b, c]) await pipeline.processStory(s.id);
    expect(edits.find((e) => e.storyId === a.id)!.transcript).toContain("накрыл буран");
    expect(edits.find((e) => e.storyId === b.id)!.transcript).not.toContain("накрыл буран");
    expect(edits.find((e) => e.storyId === c.id)).toBeUndefined();
    expect((await repo.getStory(c.id))!).toMatchObject({ status: "skipped", text_ru: null });
    expect((await repo.getStory(c.id))!.error).toContain("Повтор рассказа");
  });

  it("ответы не по порядку тем: каждый записанный ответ ровно в одной главе", async () => {
    const { pipeline, repo, edits } = setup();
    // рассказчик прыгает по темам: работа → корни → любовь → корни (уточнение пришло поздно) → детство
    const answers: [string, string, string[]][] = [
      ["work-01", "work", ["Кем работал? Шофёром на автобазе в Уштобе.", "Возил рис и сахарную свёклу до самого Талды-Кургана."]],
      ["roots-01", "roots", ["Родился в сорок восьмом году в колхозе Красный Восток.", "Мать звали Мария, отца Николай."]],
      ["love-01", "love", ["С женой познакомились на танцах в доме культуры.", "Она пела в хоре корейские песни."]],
      ["roots-02", "roots", ["Дом был саманный, с печкой кудури посередине.", "Во дворе росли абрикосы и стоял сарай для кур."]],
      ["childhood-01", "childhood", ["Зимой катались на санках с горки у школы.", "Летом ловили рыбу в арыке с братьями."]],
    ];
    const recordings: string[] = [];
    const mains: string[] = [];
    for (const [q, block, [mainText, followText]] of answers) {
      const m = st({ question_id: q, block: block as Story["block"], transcript: mainText });
      repo.add(m);
      mains.push(m.id);
      recordings.push(mainText!);
      // половину уточнений интервью приклеило само, половину — нет (расшифровка не успела)
      const child = st({ parent_story_id: m.id, question_id: q, transcript: followText, status: "ready" });
      repo.add(child);
      recordings.push(followText!);
      if (mains.length % 2) repo.stories.get(m.id)!.followups = [{ question: "А подробнее?", answer: followText!, story_id: child.id }];
      // отказ и переспрос имени («да, Уштобе») — записи есть, в главу не идут
      repo.add(st({ parent_story_id: m.id, question_id: q, transcript: "Не хочу об этом говорить.", status: "skipped" }));
    }
    // главы собираются не в порядке записи
    for (const id of [...mains].reverse()) await pipeline.processStory(id);

    const chapters = [...repo.stories.values()].filter((s) => !s.parent_story_id && s.status === "ready" && s.text_ru);
    expect(chapters).toHaveLength(answers.length);
    for (const rec of recordings) {
      const inChapters = chapters.filter((c) => (c.text_ru ?? "").includes(rec));
      expect(inChapters, rec).toHaveLength(1);
    }
    for (const c of chapters) {
      expect(c.text_ru).not.toContain("Не хочу");
      expect(fullSource(c)).toBe(c.text_ru); // глава = её основной ответ + её уточнения, ничего чужого
    }
    expect(edits).toHaveLength(answers.length);
  });
});
