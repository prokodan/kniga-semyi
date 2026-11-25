// Пункт 5: подсказки имён и мест, поиск неуверенного распознавания, разбор ответа на переспрос.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseGlossary } from "@/eval/kr-check";
import { applyName, findUncertain, GLOSSARY_KORYO, GLOSSARY_PLACES, GLOSSARY_SURNAMES, isCommonWord, nameHints, reconcileNames, resolveName } from "./names";

describe("подсказки из docs/glossary.md", () => {
  const g = parseGlossary(readFileSync("docs/glossary.md", "utf8"));
  const stem = (v: string) => v.replace(/\*$/, "").toLowerCase();
  it("каждый топоним словаря есть в GLOSSARY_PLACES (по основе)", () => {
    for (const e of g.filter((x) => x.section === "place"))
      expect(GLOSSARY_PLACES.some((p) => e.ru.some((v) => p.toLowerCase().startsWith(stem(v))))).toBe(true);
  });
  it("каждая фамилия и слово корё мар словаря — в подсказках", () => {
    for (const e of g.filter((x) => x.section === "surname")) expect(GLOSSARY_SURNAMES).toContain(e.ru[0]);
    for (const e of g.filter((x) => x.section === "koryo"))
      expect(e.ru.some((v) => (GLOSSARY_KORYO as readonly string[]).includes(v.toLowerCase()))).toBe(true);
  });
  it("семья и прошлые главы — первыми", () => {
    const h = nameHints({ storytellerName: "Ким Данил", birthPlace: "Уштобе", facts: [{ type: "person", value: "Володя" }, { type: "date", value: "1941" }] });
    expect(h.slice(0, 3)).toEqual(["Ким Данил", "Уштобе", "Володя"]);
    expect(h).not.toContain("1941");
    expect(h.length).toBeLessThanOrEqual(120);
  });
});

describe("неуверенно распознанное", () => {
  const hints = nameHints({ storytellerName: "Ким Данил", facts: [{ type: "person", value: "Володя" }] });
  it("«У штабе» ≈ Уштобе", () => expect(findUncertain("Мы жили в У штабе, у самой реки.", hints)).toEqual({ heard: "У штабе", guess: "Уштобе" }));
  it("«Уштабе» одним словом ≈ Уштобе", () => expect(findUncertain("Родился в Уштабе.", hints)?.guess).toBe("Уштобе"));
  it("правильное слово и падеж — не переспрашиваем", () => {
    expect(findUncertain("Мы жили в Уштобе, потом в Караганде.", hints)).toBeNull();
    expect(findUncertain("Отец работал в колхозе, мама шила.", hints)).toBeNull();
  });
  it("обычные слова со строчной не путаем с именами", () => expect(findUncertain("вот моя младшая сестра", hints)).toBeNull());

  const c = { heard: "У штабе", guess: "Уштобе" };
  it.each([
    ["Да.", "Уштобе"],
    ["Да, Уштобе.", "Уштобе"],
    ["Правильно, в Уштобе.", "Уштобе"],
    ["Нет, Бастобе.", "Бастобе"],
    ["Ну… там, у реки.", "Уштобе"],
  ])("ответ «%s» → %s", (answer, want) => expect(resolveName(answer, c)).toBe(want));

  it("замена во всём тексте", () => expect(applyName("Жили в У штабе. В У  штабе был арык.", "У штабе", "Уштобе")).toBe("Жили в Уштобе. В Уштобе был арык."));
});

describe("переспрос в интервью", async () => {
  const { createRouter } = await import("@/lib/ai/router");
  const { MemoryStore } = await import("@/lib/ai/store");
  const { createInterview } = await import("./engine");
  const { MemoryInterviewRepo } = await import("./repo");

  function setup() {
    const ai = createRouter({ store: new MemoryStore(), mode: () => "mock" });
    const repo = new MemoryInterviewRepo();
    repo.addFamily("fam-1", "tok-1", ["st-1"]);
    repo.names.set("st-1", "Ким Данил");
    return { repo, interview: createInterview({ ai, repo }) };
  }

  it("«У штабе» → «Правильно ли я поняла: Уштобе?» → «да» → в расшифровке Уштобе, переспрос не считается уточнением", async () => {
    const { repo, interview } = setup();
    const s = await interview.startSession({ familyId: "fam-1", storytellerId: "st-1" });
    const main = await repo.createStory({ family_id: "fam-1", storyteller_id: "st-1", session_id: s.sessionId, question_id: null, block: null, transcript: "Родился я в У штабе, в сорок первом году, отец был бригадиром, мама вела дом, нас было трое детей." });
    const r1 = await interview.submitAnswer(s.sessionId, { storyId: main.id });
    expect(r1).toMatchObject({ type: "followup", text: "Правильно ли я поняла: Уштобе?" });
    if (r1.type === "followup") expect(r1.followupsLeft).toBe(3);

    const yes = await repo.createStory({ family_id: "fam-1", storyteller_id: "st-1", session_id: s.sessionId, question_id: null, block: null, transcript: "Да, Уштобе." });
    const r2 = await interview.submitAnswer(s.sessionId, { storyId: yes.id });
    expect(r2.type === "followup" ? r2.text : "").not.toMatch(/Правильно ли я поняла/);
    const saved = repo.stories.get(main.id)!;
    expect(saved.transcript).toContain("в Уштобе, в сорок первом");
    expect(saved.followups).toHaveLength(0);
    expect(repo.stories.get(yes.id)!.status).toBe("skipped");
  });

  it("переспрашиваем один раз на историю", async () => {
    const { repo, interview } = setup();
    const s = await interview.startSession({ familyId: "fam-1", storytellerId: "st-1" });
    const r1 = await interview.submitAnswer(s.sessionId, { text: "Жили в У штабе." });
    expect(r1).toMatchObject({ type: "followup", text: "Правильно ли я поняла: Уштобе?" });
    const r2 = await interview.submitAnswer(s.sessionId, { text: "Нет, в Бастобе." });
    const story = [...repo.stories.values()][0]!;
    expect(story.transcript).toBe("Жили в Бастобе.");
    // короткий ответ — дальше обычное уточнение, но не второй переспрос
    expect(r2.type).toBe("followup");
    if (r2.type === "followup") expect(r2.text).not.toMatch(/Правильно ли я поняла/);
  });
});

describe("reconcileNames: обычные слова не трогает (#168)", () => {
  // словарь семьи мог подхватить разговорную форму как «слово корё мар» — она не должна стать целью
  const hints = nameHints({ storytellerName: "Тен Вера", entities: ["Мамо", "Папо", "Мамаев", "апа Сауле"] });

  it("«мама / мамо», «папа», «дом» остаются как есть", () => {
    for (const t of ["Мама любила готовить.", "мама любила", "Мамо любила", "Я пошёл к маме.", "Папа пришёл домой.", "Дом был большой.", "У папы был дом."]) {
      expect(reconcileNames(t, hints).text).toBe(t);
    }
  });

  it("имена, места и корё мар по-прежнему сверяются", () => {
    expect(reconcileNames("Мы жили в Уштабе.", hints).text).toBe("Мы жили в Уштобе.");
    expect(reconcileNames("опаса уле приходила", hints).text).toBe("апа Сауле приходила");
    expect(reconcileNames("Мамаеф пришёл", hints).text).toBe("Мамаев пришёл");
  });

  it("isCommonWord: обычные слова и их формы — да, имена — нет", () => {
    for (const w of ["мама", "Мамо", "мамой", "папа", "дом", "дома", "бабушка", "брату"]) expect(isCommonWord(w)).toBe(true);
    for (const w of ["Мамаев", "Домна", "Сауле", "Уштобе", "кукси"]) expect(isCommonWord(w)).toBe(false);
  });
});
