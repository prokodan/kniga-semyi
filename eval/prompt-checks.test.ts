// Эвристики уточнений, связок и сказки (V1-2) — без ИИ.
import { describe, expect, it } from "vitest";
import { checkBridge, checkDialogue, checkFollowup, checkTale, isNoPressure, pickTaleChapters, similarity } from "./prompt-checks";

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
