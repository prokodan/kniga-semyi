// #233 (флаг culture_packs): интервью задаёт вопросы по культурным пакетам семьи; подсказки расшифровке — по пакетам.
// Без пакетов (флаг выключен) — ровно банк V0 и сегодняшние подсказки.
import { describe, expect, it } from "vitest";
import { createRouter } from "@/lib/ai/router";
import { MemoryStore } from "@/lib/ai/store";
import { QUESTIONS } from "@/content/questions/bank";
import { bankForPacks, createQuestionBank, familyPacks, getQuestionBank } from "./bank";
import { createInterview, type AnswerResult } from "./engine";
import { GLOSSARY_KORYO, GLOSSARY_SURNAMES, nameHints, packHints } from "./names";
import type { SessionState } from "./policy";
import { MemoryInterviewRepo } from "./repo";

function setup(packs: string[] | null, opts: { bank?: ReturnType<typeof createQuestionBank>; failPacks?: boolean } = {}) {
  const router = createRouter({ store: new MemoryStore(), mode: () => "mock" });
  const repo = new MemoryInterviewRepo();
  repo.addFamily("fam-1", "tok-1", ["st-1"]);
  repo.names.set("st-1", "Сауле");
  if (opts.failPacks) repo.culturePacks = async () => Promise.reject(new Error("db down"));
  else repo.packs.set("fam-1", packs);
  const interview = createInterview({ ai: router, repo, ...(opts.bank ? { bank: opts.bank } : {}) });
  return { interview, repo };
}

const nextId = (r: AnswerResult) =>
  r.type === "nextQuestion" ? r.question.id : r.type === "blockDone" ? (r.nextQuestion?.id ?? null) : null;

/** Пропускать вопросы, пока не встретится нужный (или не кончится раздел). */
async function skipUntil(interview: ReturnType<typeof setup>["interview"], sessionId: string, first: string, target: string, max = 12) {
  const seen = [first];
  for (let i = 0; i < max && seen.at(-1) !== target; i++) {
    const id = nextId(await interview.skip(sessionId, "skip", { token: "tok-1" }));
    if (!id) break;
    seen.push(id);
  }
  return seen;
}

describe("банк семьи по пакетам (#233)", () => {
  it("без пакетов (флаг выключен) — банк V0, корейская строка на месте, пакеты в состояние не пишутся", async () => {
    const { interview, repo } = setup(null);
    const s = await interview.startSession({ familyId: "fam-1", storytellerId: "st-1", token: "tok-1" });
    expect(s.question).toMatchObject({ id: QUESTIONS[0]!.id, ru: QUESTIONS[0]!.ru, ko: QUESTIONS[0]!.ko });
    expect(s.question.ko).not.toBe("");
    expect((repo.sessions.get(s.sessionId)!.state as SessionState).packs).toBeUndefined();
    expect(s.progress.questionsTotal).toBe(40);
  });

  it("general + koryo (флаг включён, умолчание) — тот же банк V0", async () => {
    const { interview } = setup(["general", "koryo"]);
    const s = await interview.startSession({ familyId: "fam-1", storytellerId: "st-1", token: "tok-1" });
    expect(s.question.ko).toBe(QUESTIONS[0]!.ko);
    expect(s.progress.questionsTotal).toBe(40);
    expect(bankForPacks(["general", "koryo"])).toBe(getQuestionBank());
  });

  it("general + kz: вопросы слоя звучат по порядку, корейской строки нет, пакеты запомнены в сессии", async () => {
    const { interview, repo } = setup(["general", "kz"]);
    const s = await interview.startSession({ familyId: "fam-1", storytellerId: "st-1", token: "tok-1" });
    expect(s.question.id).toBe("roots-01");
    expect(s.question.ko).toBe("");
    expect(s.question.blockTitle.ko).toBe("");
    expect(s.progress.questionsTotal).toBe(45);
    expect((repo.sessions.get(s.sessionId)!.state as SessionState).packs).toEqual(["general", "kz"]);
    const seen = await skipUntil(interview, s.sessionId, s.question.id, "roots-kz-02");
    expect(seen.slice(0, 6)).toEqual(["roots-01", "roots-02", "roots-03", "roots-04", "roots-kz-01", "roots-kz-02"]);
  });

  it("пакеты семьи сменили посреди разговора — сессия идёт по своему банку (вопрос слоя не теряется)", async () => {
    const { interview, repo } = setup(["general", "kz"]);
    const s = await interview.startSession({ familyId: "fam-1", storytellerId: "st-1", token: "tok-1" });
    await skipUntil(interview, s.sessionId, s.question.id, "roots-kz-01");
    repo.packs.set("fam-1", null); // флаг выключили / семья сменила пакеты
    const r = await interview.skip(s.sessionId, "skip", { token: "tok-1" });
    expect(nextId(r)).toBe("roots-kz-02");
  });

  it("свой банк в deps (тесты, симулятор) важнее пакетов; сбой чтения пакетов — банк V0", async () => {
    const own = createQuestionBank([{ id: "roots-01", block: "roots", ru: "Свой вопрос?", ko: "", minimum: ["что-то"] }]);
    const a = setup(["general", "kz"], { bank: own });
    expect((await a.interview.startSession({ familyId: "fam-1", storytellerId: "st-1", token: "tok-1" })).question.ru).toBe("Свой вопрос?");
    const b = setup(null, { failPacks: true });
    const s = await b.interview.startSession({ familyId: "fam-1", storytellerId: "st-1", token: "tok-1" });
    expect(s.question.id).toBe(QUESTIONS[0]!.id);
  });

  it("familyPacks: флаг выключен — null; включён — пакеты семьи, пусто — general + koryo", () => {
    expect(familyPacks({ culture_packs: ["general", "kz"] }, false)).toBeNull();
    expect(familyPacks({ culture_packs: ["kz", "ua"] }, true)).toEqual(["general", "kz", "ua"]);
    expect(familyPacks({ culture_packs: [] }, true)).toEqual(["general", "koryo"]);
    expect(familyPacks(null, true)).toEqual(["general", "koryo"]);
  });

  it("банк general (без слоёв) — 40 вопросов без корейского, банк кэшируется", () => {
    const g = bankForPacks(["general"]);
    expect(g.all()).toHaveLength(40);
    expect(g.all().every((q) => q.ko === "")).toBe(true);
    expect(bankForPacks(["general"])).toBe(g);
  });
});

describe("подсказки расшифровке по пакетам (#233)", () => {
  const src = { storytellerName: "Сауле", birthPlace: "Шымкент" };

  it("без пакетов и general + koryo — ровно как сейчас (корё мар, топонимы, фамилии)", () => {
    expect(nameHints(src, null)).toEqual(nameHints(src));
    expect(nameHints(src, ["general", "koryo"])).toEqual(nameHints(src));
  });

  it("general — только семья, без корейских слов и фамилий; kz — казахские слова и места", () => {
    const g = nameHints(src, ["general"]);
    expect(g).toEqual(["Сауле", "Шымкент"]);
    const kz = nameHints(src, ["general", "kz"]);
    expect(kz).toEqual(expect.arrayContaining(["Наурыз", "жайлау", "Караганда"]));
    for (const w of [...GLOSSARY_KORYO, ...GLOSSARY_SURNAMES]) expect(kz, w).not.toContain(w);
  });

  it("несколько слоёв — подсказки обоих, первым — первый слой", () => {
    const h = packHints(["general", "kz", "koryo"]);
    expect(h.indexOf("Наурыз")).toBeLessThan(h.indexOf("кукси"));
    expect(h).toContain("Ким");
  });
});
