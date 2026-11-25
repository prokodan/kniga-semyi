// #99: порядок разделов по фазам, без повторов уже отвеченного и уточнений, мост при смене раздела,
// уточнение на короткий ответ во всех путях. Всё в mock, без ключей и базы.
import { describe, expect, it } from "vitest";
import { createRouter } from "@/lib/ai/router";
import { MemoryStore } from "@/lib/ai/store";
import { AiUnavailableError, type AiInput, type AiOutput, type AiStep } from "@/lib/ai/types";
import { LIFE_BLOCKS, type LifeBlock } from "@/lib/types";
import { createQuestionBank } from "./bank";
import { createInterview, type AnswerResult, type QuestionView } from "./engine";
import { BLOCK_ORDER, blockTransition, candidateQuestions, isRepeatFollowup, MAX_FOLLOWUPS, type SessionState } from "./policy";
import { MemoryInterviewRepo } from "./repo";

type Override = { [S in AiStep]?: (input: AiInput<S>) => AiOutput<S> | Promise<AiOutput<S>> };

function setup(override: Override = {}) {
  const router = createRouter({ store: new MemoryStore(), mode: () => "mock" });
  const calls: { step: AiStep; input: unknown }[] = [];
  const ai = {
    async run<S extends AiStep>(step: S, input: AiInput<S>, o?: Parameters<typeof router.run>[2]): Promise<AiOutput<S>> {
      calls.push({ step, input });
      const fn = override[step] as ((i: AiInput<S>) => AiOutput<S>) | undefined;
      return fn ? fn(input) : router.run(step, input, o);
    },
  };
  const repo = new MemoryInterviewRepo();
  repo.addFamily("fam-1", "tok-1", ["st-1"]);
  const interview = createInterview({ ai, repo });
  const start = () => interview.startSession({ familyId: "fam-1", storytellerId: "st-1", token: "tok-1" });
  return { interview, repo, calls, start };
}

const bank = createQuestionBank();
const LONG =
  "Родился я в Уштобе, в сорок первом году, в семье рисоводов. Отец Ким Сан Ир был бригадиром, мама Пак Ок Сун вела дом " +
  "и пела нам по вечерам. Помню запах риса на току и как мы с братом бегали к арыку, а потом получали от мамы за мокрые штаны.";
const done = (): AiOutput<"completeness"> => ({ covered: [], missing: [], followup: null, done: true, offTopicBlock: null });
const nextOf = (r: AnswerResult): QuestionView | null =>
  r.type === "nextQuestion" ? r.question : r.type === "blockDone" ? r.nextQuestion : null;
const bridgeOf = (r: AnswerResult) => (r.type === "nextQuestion" || r.type === "blockDone" ? r.bridge : "");

describe("#99 п. 1: разделы по фазам и по порядку", () => {
  it("порядок фаз совпадает с картой жизни: Корни → … → Слова внукам", () => {
    expect(BLOCK_ORDER).toEqual([...LIFE_BLOCKS]);
  });

  it("кандидаты — только из одного раздела: текущего, пока в нём есть открытые вопросы", () => {
    const roots = bank.inBlock("roots").map((q) => q.id);
    const state: SessionState = { answered_question_ids: [roots[0]!] };
    const c = candidateQuestions(bank, state, roots[0], "roots");
    expect(c.length).toBeGreaterThan(0);
    expect(new Set(c.map((q) => q.block))).toEqual(new Set(["roots"]));
    // раздел закрыт → следующий по порядку
    const c2 = candidateQuestions(bank, { answered_question_ids: roots }, undefined, "roots");
    expect(new Set(c2.map((q) => q.block))).toEqual(new Set(["childhood"]));
    // «позже» по всем вопросам раздела → следующий раздел, отложенные — в самом конце
    const c3 = candidateQuestions(bank, { later_question_ids: roots }, undefined, "roots");
    expect(c3[0]!.block).toBe("childhood");
  });

  it("весь разговор: разделы не прыгают, каждый следующий — по порядку, без возвратов", async () => {
    const { interview, start } = setup({ completeness: done });
    const s = await start();
    const seen: LifeBlock[] = [s.question.block];
    let r: AnswerResult = await interview.submitAnswer(s.sessionId, { text: LONG });
    for (let i = 0; i < 60 && r.type !== "finished"; i++) {
      const q = nextOf(r);
      if (q) seen.push(q.block);
      r = await interview.submitAnswer(s.sessionId, { text: LONG });
    }
    expect(r.type).toBe("finished");
    const order = seen.filter((b, i) => i === 0 || b !== seen[i - 1]);
    expect(order).toEqual(BLOCK_ORDER.filter((b) => bank.inBlock(b).length > 0));
  });

  it("next_question получает кандидатов только из текущего раздела (ИИ выбирает внутри раздела)", async () => {
    const { interview, calls, start } = setup({ completeness: done });
    const s = await start();
    await interview.submitAnswer(s.sessionId, { text: LONG });
    const nq = calls.filter((c) => c.step === "next_question").at(-1)!.input as AiInput<"next_question">;
    expect(new Set(nq.candidateQuestions.map((q) => q.block))).toEqual(new Set([s.question.block]));
    expect(nq.sameBlock).toBe(true);
  });
});

describe("#99 п. 2: уже отвеченное в прошлых рассказах не спрашиваем", () => {
  it("кандидат из alreadyAnswered пропускается и засчитан как пройденный; прошлые ответы уходят в knownAnswers", async () => {
    const roots = bank.inBlock("roots");
    const skipped = roots[2]!.id;
    const { interview, repo, calls, start } = setup({
      completeness: done,
      next_question: (i) => ({
        questionId: i.candidateQuestions[0]!.id,
        bridge: "",
        alreadyAnswered: i.candidateQuestions.some((q) => q.id === skipped) ? [skipped] : [],
      }),
    });
    const s = await start();
    const asked: string[] = [s.question.id];
    let r: AnswerResult = await interview.submitAnswer(s.sessionId, { text: LONG });
    for (let i = 0; i < 8 && r.type !== "finished"; i++) {
      const q = nextOf(r);
      if (!q || q.block !== "roots") break;
      asked.push(q.id);
      r = await interview.submitAnswer(s.sessionId, { text: LONG });
    }
    expect(asked).not.toContain(skipped);
    const state = repo.sessions.get(s.sessionId)!.state as SessionState;
    expect(state.covered_question_ids).toContain(skipped);
    const nq = calls.find((c) => c.step === "next_question")!.input as AiInput<"next_question">;
    expect(nq.knownAnswers?.[0]).toContain("Уштобе");
  });

  it("модель отметила весь остаток раздела — сразу следующий раздел, без второго вызова", async () => {
    const roots = bank.inBlock("roots").map((q) => q.id);
    const { interview, calls, start } = setup({
      completeness: done,
      next_question: (i) => ({ questionId: i.candidateQuestions[0]!.id, bridge: "", alreadyAnswered: i.candidateQuestions.map((q) => q.id) }),
    });
    const s = await start();
    let r: AnswerResult = await interview.submitAnswer(s.sessionId, { text: LONG });
    let guard = 0;
    while (nextOf(r)?.block === "roots" && guard++ < 10) r = await interview.submitAnswer(s.sessionId, { text: LONG });
    expect(nextOf(r)?.block).toBe("childhood");
    // за один переход — не больше двух «уже отвечено» и один вызов next_question
    expect(calls.filter((c) => c.step === "next_question").length).toBeLessThanOrEqual(roots.length);
  });
});

describe("#99 п. 3: уточнения не повторяются", () => {
  it("isRepeatFollowup: дословно и по смыслу", () => {
    const prev = ["А помните ли вы какую-нибудь его привычку?"];
    expect(isRepeatFollowup("А помните ли вы какую-нибудь его привычку?", prev)).toBe(true);
    expect(isRepeatFollowup("А какая у него была привычка?", prev)).toBe(true);
    expect(isRepeatFollowup("А в каком году вы переехали в Ташкент?", prev)).toBe(false);
  });

  it("модель предлагает то же уточнение снова — задаём другое; всего не больше 3; уже заданные уходят в модель", async () => {
    const { interview, calls, start } = setup({
      completeness: () => ({ covered: [], missing: ["кто", "когда", "где"], followup: "А помните ли вы какую-нибудь его привычку?", done: false, offTopicBlock: null }),
    });
    const s = await start();
    const texts: string[] = [];
    let r: AnswerResult = await interview.submitAnswer(s.sessionId, { text: "Да, было." });
    while (r.type === "followup") {
      texts.push(r.text);
      r = await interview.submitAnswer(s.sessionId, { text: "Да, было." });
    }
    expect(texts.length).toBeLessThanOrEqual(MAX_FOLLOWUPS);
    expect(texts.length).toBeGreaterThan(1);
    for (let i = 1; i < texts.length; i++) expect(isRepeatFollowup(texts[i]!, texts.slice(0, i))).toBe(false);
    const last = calls.filter((c) => c.step === "completeness").at(-1)!.input as AiInput<"completeness">;
    expect(last.askedFollowups).toEqual(texts);
  });

  it("то же уточнение не звучит и на следующем вопросе сессии", async () => {
    const same = "А помните ли вы какую-нибудь его привычку?";
    const { interview, start } = setup({
      completeness: (i) =>
        i.followupsAsked === 0
          ? { covered: [], missing: ["кто"], followup: same, done: false, offTopicBlock: null }
          : { covered: [], missing: [], followup: null, done: true, offTopicBlock: null },
    });
    const s = await start();
    const r1 = await interview.submitAnswer(s.sessionId, { text: "Да, было так." });
    expect(r1.type === "followup" && r1.text).toBe(same);
    await interview.submitAnswer(s.sessionId, { text: LONG });
    const r2 = await interview.submitAnswer(s.sessionId, { text: "Да, было так." });
    expect(r2.type).toBe("followup");
    if (r2.type === "followup") expect(isRepeatFollowup(r2.text, [same])).toBe(false);
  });
});

describe("#99 п. 4: мост при смене раздела", () => {
  it("новый раздел — «Спасибо! Теперь давайте поговорим о …», похвала модели не звучит", async () => {
    const praise = "Как здорово про работу на автобазе!";
    const { interview, start } = setup({
      completeness: done,
      next_question: (i) => ({ questionId: i.candidateQuestions[0]!.id, bridge: praise }),
    });
    const s = await start();
    let r: AnswerResult = await interview.submitAnswer(s.sessionId, { text: LONG });
    // внутри раздела — связка модели
    expect(nextOf(r)?.block).toBe("roots");
    expect(bridgeOf(r)).toBe(praise);
    let guard = 0;
    while (nextOf(r)?.block === "roots" && guard++ < 10) r = await interview.submitAnswer(s.sessionId, { text: LONG });
    expect(nextOf(r)?.block).toBe("childhood");
    expect(bridgeOf(r)).toBe(blockTransition("childhood"));
    expect(bridgeOf(r)).toBe("Спасибо! Теперь давайте поговорим о вашем детстве.");
  });

  it("«пропустить» на последнем вопросе раздела — фраза движка + мост", async () => {
    const { interview, start } = setup({ completeness: done });
    const s = await start();
    let r: AnswerResult = await interview.skip(s.sessionId, "skip");
    let guard = 0;
    while (nextOf(r)?.block === "roots" && guard++ < 10) r = await interview.skip(s.sessionId, "skip");
    expect(bridgeOf(r)).toBe(`Хорошо, давайте о другом. ${blockTransition("childhood")}`);
  });
});

describe("#99 п. 5: короткий ответ (< 15 слов) — хотя бы одно уточнение во всех путях", () => {
  const short = "Бабушку с дедушкой я почти не помню.";

  it("текст: модель сказала done — всё равно уточнение", async () => {
    const { interview, start } = setup({ completeness: done });
    const s = await start();
    expect((await interview.submitAnswer(s.sessionId, { text: short })).type).toBe("followup");
  });

  it("голос (storyId): расшифровка короткая — уточнение", async () => {
    const { interview, repo, start } = setup({ completeness: done });
    const s = await start();
    const story = await repo.createStory({ family_id: "fam-1", storyteller_id: "st-1", session_id: null, question_id: null, block: null, transcript: short });
    expect((await interview.submitAnswer(s.sessionId, { storyId: story.id })).type).toBe("followup");
  });

  it("ИИ недоступен — запасное уточнение без ИИ", async () => {
    const { interview, start } = setup({
      completeness: () => {
        throw new AiUnavailableError("completeness", []);
      },
    });
    const s = await start();
    const r = await interview.submitAnswer(s.sessionId, { text: short });
    expect(r.type).toBe("followup");
    if (r.type === "followup") expect(r.text.match(/\?/g)?.length).toBe(1);
  });

  it("после ответа на уточнение — без лишнего давления: второе уточнение только если модель просит", async () => {
    const { interview, start } = setup({ completeness: done });
    const s = await start();
    await interview.submitAnswer(s.sessionId, { text: short });
    const r = await interview.submitAnswer(s.sessionId, { text: "Не помню." });
    expect(r.type).not.toBe("followup");
  });
});

describe("связка модели без висящего «А…» (sim 25.11: «…про Уштобе. А А каким был ваш папа?»)", () => {
  it.each([
    ["Спасибо, что рассказали про Уштобе. А", "Спасибо, что рассказали про Уштобе."],
    ["Спасибо, что рассказали про маму и кукси. А…", "Спасибо, что рассказали про маму и кукси."],
    ["Спасибо, что рассказали про кукси", "Спасибо, что рассказали про кукси."],
    ["Спасибо за рассказ про Амангельды.", "Спасибо за рассказ про Амангельды."],
    ["", ""],
  ])("cleanBridge(%s)", async (input, expected) => {
    const { cleanBridge } = await import("./policy");
    expect(cleanBridge(input)).toBe(expected);
  });
});
