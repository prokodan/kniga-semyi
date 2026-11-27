// Эвристики уточнений, связок и сказки (V1-2) — без ИИ.
import { describe, expect, it } from "vitest";
import { checkBridge, checkDialogue, checkFollowup, checkTale, foldKz, foreignRealiaIssues, isNoPressure, pickTaleChapters, similarity } from "./prompt-checks";

describe("уточнения", () => {
  it("хорошее уточнение — без флажков", () => {
    expect(checkFollowup("Вы сказали, что мама шила на всю улицу — а как её звали?", [])).toEqual([]);
  });
  it("ловит длину, два вопроса, «ты», «подробнее» и повтор", () => {
    expect(checkFollowup("А где это было? И когда?", [])).toContain("два вопроса в одном");
    expect(checkFollowup("А ты помнишь, как звали маму?", [])).toContain("на «ты»");
    expect(checkFollowup("Расскажите подробнее, пожалуйста.", [])).toContain("общее «расскажите подробнее»");
    expect(checkFollowup("А как звали вашу маму?", ["Как звали вашу маму?"])).toContain("повтор прошлого уточнения");
    expect(checkFollowup(Array(17).fill("слово").join(" ") + "?", [])[0]).toMatch(/длинное/);
  });
  it("давление: вежливый отказ и боль, которые не ловит detectSignal", () => {
    expect(isNoPressure("Это не для книги, извините.")).toBe(true);
    expect(isNoPressure("(вздыхает) Давайте о другом.")).toBe(true);
    expect(isNoPressure("Работал на заводе, токарем.")).toBe(false);
  });
});

describe("связки", () => {
  it("короткая тёплая — без флажков; вопрос, лесть, повтор — флажки", () => {
    expect(checkBridge("Как интересно про кукси!", [])).toEqual([]);
    expect(checkBridge("Вы прекрасно рассказываете!", [])).toContain("лесть");
    expect(checkBridge("А правда?", [])).toContain("вопрос в связке");
    expect(checkBridge("Спасибо, что рассказали про маму.", ["Спасибо, что рассказали про маму!"])).toContain("повтор прошлой связки");
  });
  it("similarity: одинаковые — 1, разные — 0", () => {
    expect(similarity("кукси у мамы", "кукси у мамы")).toBe(1);
    expect(similarity("кукси", "рыбалка")).toBe(0);
  });
});

describe("checkDialogue", () => {
  it("достаёт связку из основного вопроса, пропускает фразы движка, считает давление", () => {
    const r = checkDialogue({
      questions: [
        { id: "q1", block: "childhood", text: "Где вы родились?", followups: 1, outcome: "answered" },
        { id: "q2", block: "work", text: "Кем вы работали?", followups: 0, outcome: "answered" },
        { id: "q3", block: "roots", text: "Расскажите об отце.", followups: 0, outcome: "skipped" },
      ],
      turns: [
        { role: "agent", text: "Где вы родились?", questionId: "q1" },
        { role: "persona", text: "Не хочу, это не для книги." },
        { role: "followup", text: "А в каком году?", questionId: "q1" },
        { role: "persona", text: "В пятьдесят втором." },
        { role: "followup", text: "Какая история! Я сохраню её…", questionId: "q1" },
        { role: "agent", text: "Как интересно про Кзыл-Орду! Кем вы работали?", questionId: "q2" },
        { role: "persona", text: "Инженером." },
        { role: "agent", text: "Хорошо, не будем об этом. Давайте о другом. Расскажите об отце.", questionId: "q3" },
      ],
    });
    expect(r.followups).toBe(1);
    expect(r.pressure).toBe(1);
    expect(r.bridges).toBe(1);
    expect(r.bridgeTexts).toEqual(["Как интересно про Кзыл-Орду!"]);
    expect(r.bridgeIssues).toEqual([]);
  });
});

describe("сказка", () => {
  const source = {
    storytellerName: "Ким Николай Петрович",
    stories: [{ title: "Кукси у мамы", text_ru: "В 1950 году в Уштобе мама варила кукси. Мы с братом Петей ловили рыбу в арыке." }],
  };
  const page = (text: string) => ({ text, illustrationPrompt: "a boy by a canal, morning" });

  it("хорошая сказка — без флажков", () => {
    const t = checkTale(
      {
        title: "Мальчик и арык",
        pages: [
          page("Жил-был мальчик Николай. Он жил в Уштобе."),
          page("Мама варила кукси, а Николай с братом Петей бежал к арыку."),
          page("Рыбка блеснула на солнце, и мальчики засмеялись."),
          page("Этот мальчик вырос. Теперь он твой дедушка."),
        ],
      },
      source,
    );
    expect(t.issues).toEqual([]);
  });

  it("склонение короткого имени из глав — не чужое имя", () => {
    const t = checkTale({ title: "X", pages: [page("Мама Елена пела."), page("а"), page("б"), page("Знаешь, эта девочка — твоя бабушка.")] }, {
      storytellerName: "Пак Мария Ивановна",
      stories: [{ title: "Мама", text_ru: "Маму звали Елена." }],
    });
    expect(t.issues.filter((i) => /нет в главах/.test(i.issue))).toEqual([]);
    const t2 = checkTale({ title: "X", pages: [page("Он помогал маме Елене.")] }, { storytellerName: "Пак Мария Ивановна", stories: [{ title: "Мама", text_ru: "Маму звали Елена." }] });
    expect(t2.issues.filter((i) => /нет в главах/.test(i.issue))).toEqual([]);
  });

  it("ловит страницы, страшное, чужой год и имя, финал, русский в illustrationPrompt", () => {
    const t = checkTale(
      {
        title: "X",
        pages: [
          page("В 1937 году началась война."),
          page("Коля встретил друга Серёжу у реки."),
          { text: "Было весело.", illustrationPrompt: "мальчик у реки" },
        ],
      },
      source,
    );
    const issues = t.issues.map((i) => i.issue).join("\n");
    expect(issues).toMatch(/страниц 3/);
    expect(issues).toMatch(/страшное/);
    expect(issues).toMatch(/год 1937/);
    expect(issues).toMatch(/Серёжу/);
    expect(issues).toMatch(/финал/);
    expect(issues).toMatch(/не на английском/);
  });

  it("pickTaleChapters: сказочные блоки первыми, по одной из блока, не больше 5", () => {
    const ch = (block: string, n: number) => ({ block, title: `${block}${n}`, text_ru: "текст" });
    const picked = pickTaleChapters([ch("hardship", 1), ch("work", 1), ch("childhood", 1), ch("childhood", 2), ch("roots", 1), ch("love", 1), ch("legacy", 1)]);
    expect(picked.map((p) => p.title)).toEqual(["childhood1", "roots1", "love1", "work1", "legacy1"]);
  });
});

describe("#282: чужие реалии в уточнениях и связках", () => {
  const sim = (followup: string, bridge: string, said = "Жили в ауле под Талдыкорганом.") => ({
    questions: [
      { id: "q1", block: "childhood" as const, text: "Где вы родились?", followups: 1, outcome: "answered" as const },
      { id: "q2", block: "traditions" as const, text: "Какие праздники отмечали?", followups: 0, outcome: "answered" as const },
    ],
    turns: [
      { role: "agent" as const, text: "Где вы родились?", questionId: "q1" },
      { role: "persona" as const, text: said },
      { role: "followup" as const, text: followup, questionId: "q1" },
      { role: "persona" as const, text: "Да." },
      { role: "agent" as const, text: `${bridge} Какие праздники отмечали?`, questionId: "q2" },
    ],
  });

  it("general + kz: корё-слово агента — флажок; казахское — нет", () => {
    const r = checkDialogue(sim("А кукси дома готовили?", "Помню про жайлау."), ["general", "kz"]);
    expect(r.foreignRealia?.map((i) => i.issue)).toEqual([expect.stringMatching(/корё «кукси»/)]);
  });

  it("general: казахские и корё-реалии — флажки; рассказчик сам назвал — не флажок", () => {
    expect(checkDialogue(sim("А на Наурыз что готовили?", "Спасибо."), ["general"]).foreignRealia).toHaveLength(1);
    expect(checkDialogue(sim("А на Наурыз что готовили?", "Спасибо.", "Мы всегда на Наурыз собирались."), ["general"]).foreignRealia).toHaveLength(0);
    expect(foreignRealiaIssues("Стоит вспомнить тот день", ["general"], "")).toEqual([]);
    expect(foreignRealiaIssues("Какой был той?", ["general"], "")).toHaveLength(1);
    expect(foreignRealiaIssues("Какой был той?", ["general", "kz"], "")).toHaveLength(0);
  });

  it("без пакетов (kim, pak, tsoi — банк V0) поля нет: отчёт прежний", () => {
    expect(checkDialogue(sim("А кукси дома готовили?", "Спасибо."))).not.toHaveProperty("foreignRealia");
  });
});

describe("сказка RU + KZ: казахские буквы в именах", () => {
  it("«Серік» / «Жақып» в главах = «Серик» / «Жакып» в сказке — не «нет в главах»", () => {
    const tale = {
      title: "Сказка про лошадей",
      pages: [
        { text: "Жил на свете мальчик Серик. Он любил степь.", illustrationPrompt: "a boy in the steppe" },
        { text: "Там дедушка Жакып держал лошадей.", illustrationPrompt: "horses" },
        { text: "Лошади были быстрые.", illustrationPrompt: "horses running" },
        { text: "Этот мальчик Серик — твой дедушка.", illustrationPrompt: "grandfather smiling" },
      ],
    };
    const r = checkTale(tale, { storytellerName: "Жұмабеков Серік Әлиұлы", stories: [{ title: "Жайлау", text_ru: "Летом мы ездили к деду Жақыпу, он держал лошадей." }] });
    expect(r.issues.filter((i) => /нет в главах/.test(i.issue))).toEqual([]);
    expect(foldKz("Серік Жақып Әлиұлы")).toBe("Серик Жакып Алиулы");
  });
});
