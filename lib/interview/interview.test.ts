// Сценарии интервью-агента на 7 профилях из eval/behaviors.md. Всё в mock: роутер ИИ с заглушкой
// (createRouter + MemoryStore) и, где нужно, подменённые ответы модели. Ключи и база не нужны.
import { describe, expect, it } from "vitest";
import { createRouter } from "@/lib/ai/router";
import { MemoryStore } from "@/lib/ai/store";
import { AiUnavailableError, type AiInput, type AiOutput, type AiStep } from "@/lib/ai/types";
import { LIFE_BLOCKS, type Question } from "@/lib/types";
import { createQuestionBank } from "./bank";
import { createInterview, InterviewError, type AnswerResult } from "./engine";
import type { SessionState } from "./policy";
import { MemoryInterviewRepo } from "./repo";

type Override = { [S in AiStep]?: (input: AiInput<S>) => AiOutput<S> | Promise<AiOutput<S>> };

/** Роутер в режиме mock + счётчик вызовов + точечная подмена ответов модели. */
function setup(opts: { override?: Override; questions?: Question[] } = {}) {
  const router = createRouter({ store: new MemoryStore(), mode: () => "mock" });
  const calls: { step: AiStep; input: unknown }[] = [];
  const ai = {
    async run<S extends AiStep>(step: S, input: AiInput<S>, o?: Parameters<typeof router.run>[2]): Promise<AiOutput<S>> {
      calls.push({ step, input });
      const fn = opts.override?.[step] as ((i: AiInput<S>) => AiOutput<S>) | undefined;
      return fn ? fn(input) : router.run(step, input, o);
    },
  };
  const repo = new MemoryInterviewRepo();
  repo.addFamily("fam-1", "tok-1", ["st-1"]);
  repo.names.set("st-1", "Ким Ен Хо");
  const bank = opts.questions ? createQuestionBank(opts.questions) : undefined;
  const interview = createInterview({ ai, repo, bank });
  const count = (step: AiStep) => calls.filter((c) => c.step === step).length;
  return { interview, repo, calls, count };
}

async function start(interview: ReturnType<typeof setup>["interview"]) {
  return interview.startSession({ familyId: "fam-1", storytellerId: "st-1", mode: "family", token: "tok-1" });
}

const LONG = (extra = "") =>
  `Родился я в Уштобе, в сорок первом году, в семье рисоводов. Отец Ким Сан Ир был бригадиром, мама Пак Ок Сун
  вела дом и пела нам по вечерам. Помню запах риса на току и как мы с братом бегали к арыку. ${extra}`.repeat(2);

const done = (covered: string[]): AiOutput<"completeness"> => ({ covered, missing: [], followup: null, done: true, offTopicBlock: null });

describe("интервью-агент: профили eval/behaviors.md", () => {
  it("one-word → до 3 уточнений, каждое сохраняется в stories.followups, потом дальше без давления", async () => {
    const { interview, repo, count } = setup();
    const s = await start(interview);
    let r: AnswerResult = await interview.submitAnswer(s.sessionId, { text: "Да, было." }, { token: "tok-1" });
    const followups: string[] = [];
    while (r.type === "followup") {
      followups.push(r.text);
      expect(r.questionId).toBe(s.question.id);
      r = await interview.submitAnswer(s.sessionId, { text: "Да, было." }, { token: "tok-1" });
    }
    expect(followups).toHaveLength(3);
    expect(count("completeness")).toBe(4);
    expect(r.type === "nextQuestion" || r.type === "blockDone").toBe(true);

    const story = [...repo.stories.values()][0]!;
    expect(story.question_id).toBe(s.question.id);
    expect(story.transcript).toBe("Да, было.");
    expect(story.followups).toHaveLength(3);
    expect(story.followups[0]).toEqual({ question: followups[0], answer: "Да, было." });
  });

  it("каждое уточнение — один вопрос (одна фраза с одним «?»)", async () => {
    const { interview } = setup();
    const s = await start(interview);
    const r = await interview.submitAnswer(s.sessionId, { text: "Ну жили и жили." });
    expect(r.type).toBe("followup");
    if (r.type === "followup") expect(r.text.match(/\?/g)?.length).toBe(1);
  });

  it("wanders → рассказ засчитан в offTopicBlock, не потерян; мягкий возврат к вопросу", async () => {
    let first = true;
    const { interview, repo } = setup({
      override: {
        completeness: (i) => {
          if (first) {
            first = false;
            return { covered: [], missing: i.minimum, followup: null, done: false, offTopicBlock: "traditions" };
          }
          return done(i.minimum);
        },
      },
    });
    const s = await start(interview);
    expect(s.question.block).toBe("roots");
    const r1 = await interview.submitAnswer(s.sessionId, { text: "А вот мама кукси на Новый год делала, тесто сама раскатывала…" });
    expect(r1.type).toBe("followup");
    if (r1.type === "followup") {
      expect(r1.text).toContain("Традиции и кухня");
      expect(r1.text).toContain(s.question.ru);
    }
    const offtopic = [...repo.stories.values()][0]!;
    expect(offtopic.block).toBe("traditions");
    expect(offtopic.question_id).toBeNull();
    expect(offtopic.transcript).toContain("кукси");

    const r2 = await interview.submitAnswer(s.sessionId, { text: LONG() });
    expect(r2.type).not.toBe("followup");
    const stories = [...repo.stories.values()];
    expect(stories).toHaveLength(2);
    expect(stories[1]!.question_id).toBe(s.question.id);
    expect(stories[1]!.block).toBe("roots");
    expect(repo.sessions.get(s.sessionId)!.state).toMatchObject({ offtopic_blocks: ["traditions"] });
  });

  it("confuses-dates → не спорит: без уточнения про год, текст сохранён как сказан", async () => {
    const { interview, repo } = setup();
    const s = await start(interview);
    const text = LONG("Это было в пятьдесят втором… нет, постойте, в пятьдесят четвёртом году.");
    const r = await interview.submitAnswer(s.sessionId, { text });
    expect(r.type).not.toBe("followup");
    expect([...repo.stories.values()][0]!.transcript).toBe(text.trim());
  });

  it("koryo-mar → слова корё мар не теряются в истории", async () => {
    const { interview, repo } = setup();
    const s = await start(interview);
    const text = LONG("Омани варила кукси, а абай солил чимчи на всю зиму.");
    await interview.submitAnswer(s.sessionId, { text });
    const t = [...repo.stories.values()][0]!.transcript!;
    for (const w of ["Омани", "кукси", "абай", "чимчи"]) expect(t).toContain(w);
  });

  it("refuses → сразу дальше: без уточнений и без проверки полноты", async () => {
    const { interview, repo, count } = setup();
    const s = await start(interview);
    const r = await interview.submitAnswer(s.sessionId, { text: "Об этом не хочу говорить, давайте дальше." });
    expect(count("completeness")).toBe(0);
    expect(r.type === "nextQuestion" || r.type === "blockDone").toBe(true);
    const state = repo.sessions.get(s.sessionId)!.state;
    expect(state.skipped_question_ids).toContain(s.question.id);
    expect(repo.stories.size).toBe(0); // отказ не становится главой
  });

  it("long → не перебивает уточнениями, если минимум собран", async () => {
    const { interview, count } = setup();
    const s = await start(interview);
    const r = await interview.submitAnswer(s.sessionId, { text: LONG("А ещё было вот что… ".repeat(30)) });
    expect(r.type).not.toBe("followup");
    expect(count("completeness")).toBe(1);
  });

  it("emotional → тёплая пауза и «вернуться позже», уточнений нет; рассказ сохранён", async () => {
    const { interview, repo, count } = setup();
    const s = await start(interview);
    const r = await interview.submitAnswer(s.sessionId, { text: "Отец ушёл на фронт… (плачет) Простите, тяжело вспоминать." });
    expect(count("completeness")).toBe(0);
    expect(r.type).toBe("nextQuestion");
    if (r.type === "nextQuestion") {
      expect(r.pause).toBe(true);
      expect(r.bridge).toMatch(/позже/);
    }
    const state = repo.sessions.get(s.sessionId)!.state;
    expect(state.later_question_ids).toContain(s.question.id);
    expect(repo.stories.size).toBe(1);
  });

  it("emotional → следующий ответ не получает уточнения подряд", async () => {
    const { interview } = setup();
    const s = await start(interview);
    await interview.submitAnswer(s.sessionId, { text: "(плачет) Не могу об этом говорить сейчас." });
    const r = await interview.submitAnswer(s.sessionId, { text: "Да." });
    expect(r.type).not.toBe("followup");
  });
});

describe("интервью-агент: пропуск, позже, блоки, банк", () => {
  it("«пропустить» и «позже» — без уточнений; отложенный вопрос возвращается в конце", async () => {
    const { interview, repo, count } = setup();
    const s = await start(interview);
    const r1 = await interview.skip(s.sessionId, "later", { token: "tok-1" });
    expect(count("completeness")).toBe(0);
    expect(r1.type).toBe("nextQuestion");
    if (r1.type === "nextQuestion") expect(r1.question.id).not.toBe(s.question.id);

    // Проходим весь остальной банк — последним вернётся отложенный roots-01.
    let last: AnswerResult = r1;
    const seen: string[] = [];
    const guard = createQuestionBank().all().length * 2 + 5;
    for (let i = 0; i < guard && last.type !== "finished"; i++) {
      const qid = last.type === "nextQuestion" ? last.question.id : last.type === "blockDone" ? last.nextQuestion?.id : undefined;
      if (qid) seen.push(qid);
      last = await interview.skip(s.sessionId, "skip");
    }
    expect(seen.at(-1)).toBe(s.question.id);
    expect(last.type).toBe("finished");
    expect(repo.sessions.get(s.sessionId)!.ended_at).not.toBeNull();
    await expect(interview.skip(s.sessionId, "skip")).rejects.toMatchObject({ code: "finished" });
  });

  it("«пропустить» во время уточнений = хватит уточнять, ответ засчитан", async () => {
    const { interview, repo } = setup();
    const s = await start(interview);
    const r = await interview.submitAnswer(s.sessionId, { text: "Да." });
    expect(r.type).toBe("followup");
    await interview.skip(s.sessionId, "skip");
    const state = repo.sessions.get(s.sessionId)!.state as SessionState;
    expect(state.answered_question_ids).toContain(s.question.id);
    expect(state.skipped_question_ids).not.toContain(s.question.id);
  });

  it("блок закрыт по всем вопросам → blockDone + предложение собрать главу + следующий вопрос", async () => {
    const two: Question[] = LIFE_BLOCKS.flatMap((b) =>
      [1, 2].map((n) => ({ id: `${b}-0${n}`, block: b, ru: `Вопрос ${b} ${n}?`, ko: "질문?", minimum: ["кто", "когда"] })),
    );
    const { interview } = setup({ questions: two });
    const s = await start(interview);
    expect(s.question.id).toBe("roots-01");
    expect(s.progress).toMatchObject({ blocksTotal: 8, questionsTotal: 16, blocksDone: 0 });

    // mock next_question выбирает непокрытый блок — поэтому второй вопрос roots закрываем явно.
    const r1 = await interview.submitAnswer(s.sessionId, { text: LONG() });
    expect(r1.type).toBe("nextQuestion");
    let r: AnswerResult = r1;
    let guard = 0;
    while (r.type !== "blockDone" && guard++ < 20) r = await interview.submitAnswer(s.sessionId, { text: LONG() });
    expect(r.type).toBe("blockDone");
    if (r.type === "blockDone") {
      expect(r.suggestChapter).toBe(true);
      expect(r.message).toContain(r.blockTitle.ru);
      expect(r.nextQuestion).not.toBeNull();
      expect(r.progress.blocksDone).toBe(1);
    }
  });

  it("next_question вернул id не из кандидатов → берём первый кандидат по банку", async () => {
    const { interview } = setup({ override: { next_question: () => ({ questionId: "nope-99", bridge: "Связка" }) } });
    const s = await start(interview);
    const r = await interview.skip(s.sessionId, "skip");
    expect(r.type === "nextQuestion" || r.type === "blockDone").toBe(true);
    const next = r.type === "nextQuestion" ? r.question : r.type === "blockDone" ? r.nextQuestion : null;
    // Первый кандидат = первый открытый вопрос банка (W0: childhood-01, V0: roots-02).
    expect(next?.id).toBe(createQuestionBank().all().find((x) => x.id !== s.question.id)!.id);
  });

  it("ИИ недоступен → короткий ответ: запасное уточнение без ИИ (#99 п. 5), затем ответ принят по порядку банка", async () => {
    const unavailable = () => {
      throw new AiUnavailableError("completeness", []);
    };
    const { interview, repo } = setup({
      override: {
        completeness: unavailable,
        next_question: () => {
          throw new AiUnavailableError("next_question", []);
        },
      },
    });
    const s = await start(interview);
    const f = await interview.submitAnswer(s.sessionId, { text: "Да." });
    expect(f.type).toBe("followup");
    const r = await interview.submitAnswer(s.sessionId, { text: "Да." });
    expect(r.type === "nextQuestion" || r.type === "blockDone").toBe(true);
    expect(repo.stories.size).toBe(1);
  });

  it("ответ голосом: storyId → берётся transcript; пока нет расшифровки — not_ready", async () => {
    const { interview, repo } = setup();
    const s = await start(interview);
    const story = await repo.createStory({
      family_id: "fam-1",
      storyteller_id: "st-1",
      session_id: s.sessionId,
      question_id: null,
      block: null,
      transcript: null,
    });
    await expect(interview.submitAnswer(s.sessionId, { storyId: story.id })).rejects.toMatchObject({ code: "not_ready" });
    await repo.updateStory(story.id, { transcript: LONG() });
    const r = await interview.submitAnswer(s.sessionId, { storyId: story.id });
    expect(r.type).not.toBe("followup");
    expect(repo.stories.get(story.id)).toMatchObject({ question_id: s.question.id, block: s.question.block });
    expect(repo.stories.size).toBe(1); // новую историю не создали
  });

  it("чужой токен и чужой рассказчик → forbidden", async () => {
    const { interview } = setup();
    await expect(interview.startSession({ familyId: "fam-1", storytellerId: "st-1", token: "bad" })).rejects.toBeInstanceOf(InterviewError);
    await expect(interview.startSession({ familyId: "fam-1", storytellerId: "st-x", token: "tok-1" })).rejects.toMatchObject({ code: "forbidden" });
    const s = await start(interview);
    await expect(interview.submitAnswer(s.sessionId, { text: "Да." }, { token: "bad" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("киоск работает тем же механизмом (mode = kiosk)", async () => {
    const { interview, repo } = setup();
    const s = await interview.startSession({ familyId: "fam-1", storytellerId: "st-1", mode: "kiosk", volunteerId: "vol-1" });
    expect(s.mode).toBe("kiosk");
    expect(repo.sessions.get(s.sessionId)).toMatchObject({ mode: "kiosk", volunteer_id: "vol-1" });
    const r = await interview.submitAnswer(s.sessionId, { text: "Да." });
    expect(r.type).toBe("followup");
  });

  it("полный банк V0 (8 × 5) подменяется без правки кода агента", async () => {
    const full: Question[] = [...LIFE_BLOCKS]
      .reverse() // порядок в файле не важен: банк сортирует по карте жизни
      .flatMap((b) => [1, 2, 3, 4, 5].map((n) => ({ id: `${b}-0${n}`, block: b, ru: `Вопрос ${b} ${n}?`, ko: "질문?", minimum: [] })));
    const bank = createQuestionBank(full);
    expect(bank.all()).toHaveLength(40);
    expect(bank.first().id).toBe("roots-01");
    expect(bank.get("legacy-05")!.minimum.length).toBeGreaterThan(0); // пустой минимум → по умолчанию
    const { interview } = setup({ questions: full });
    const s = await start(interview);
    expect(s.progress.questionsTotal).toBe(40);
    const r = await interview.submitAnswer(s.sessionId, { text: LONG() });
    expect(r.type).toBe("nextQuestion");
  });
});

describe("#107: долгая расшифровка — ответ, а не пропуск", () => {
  const recording = (repo: MemoryInterviewRepo, sessionId: string, opts: { transcript?: string | null; question_id?: string | null; family_id?: string } = {}) =>
    repo.createStory({
      family_id: opts.family_id ?? "fam-1",
      storyteller_id: "st-1",
      session_id: sessionId,
      question_id: opts.question_id ?? null,
      block: null,
      transcript: opts.transcript ?? null,
    });

  it("основной ответ ещё расшифровывается → вопрос засчитан, запись привязана, без уточнений и без сборки сейчас", async () => {
    const { interview, repo, count } = setup();
    const s = await start(interview);
    const rec = await recording(repo, s.sessionId);
    const r = await interview.skip(s.sessionId, "skip", { token: "tok-1", storyId: rec.id });
    expect(count("completeness")).toBe(0);
    expect(r.type === "nextQuestion" || r.type === "blockDone").toBe(true);
    expect(r.storyId).toBeNull(); // главу запустит конвейер после расшифровки
    if (r.type === "nextQuestion") expect(r.bridge).toContain("рассказ сохранён");
    const state = repo.sessions.get(s.sessionId)!.state as SessionState;
    expect(state.answered_question_ids).toContain(s.question.id);
    expect(state.skipped_question_ids ?? []).not.toContain(s.question.id);
    const saved = repo.stories.get(rec.id)!;
    expect(saved.question_id).toBe(s.question.id);
    expect(saved.block).toBe(s.question.block);
    expect(saved.parent_story_id).toBeNull();
    expect(r.progress.questionsDone).toBe(1);
  });

  it("расшифровка успела к моменту «не ждать» → storyId для сборки главы", async () => {
    const { interview, repo } = setup();
    const s = await start(interview);
    const rec = await recording(repo, s.sessionId, { transcript: LONG(), question_id: s.question.id });
    const r = await interview.skip(s.sessionId, "skip", { storyId: rec.id });
    expect(r.storyId).toBe(rec.id);
  });

  it("ответ на уточнение ещё расшифровывается → приклеен к основному рассказу, вопрос засчитан", async () => {
    const { interview, repo } = setup();
    const s = await start(interview);
    const f = await interview.submitAnswer(s.sessionId, { text: "Да." });
    expect(f.type).toBe("followup");
    const mainId = f.storyId!;
    const rec = await recording(repo, s.sessionId, { question_id: s.question.id });
    const r = await interview.skip(s.sessionId, "skip", { storyId: rec.id });
    expect(r.storyId).toBe(mainId);
    expect(repo.stories.get(rec.id)!.parent_story_id).toBe(mainId);
    const state = repo.sessions.get(s.sessionId)!.state as SessionState;
    expect(state.answered_question_ids).toContain(s.question.id);
  });

  it("чужая запись → not_found, состояние не меняется", async () => {
    const { interview, repo } = setup();
    repo.addFamily("fam-2", "tok-2", ["st-2"]);
    const s = await start(interview);
    const rec = await recording(repo, s.sessionId, { family_id: "fam-2" });
    await expect(interview.skip(s.sessionId, "skip", { storyId: rec.id })).rejects.toMatchObject({ code: "not_found" });
    const state = repo.sessions.get(s.sessionId)!.state as SessionState;
    expect(state.current_question_id).toBe(s.question.id);
  });
});
