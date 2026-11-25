import { describe, expect, it } from "vitest";
import { fixCyrillic, hangulizeRu, hasCyrillic } from "./cyrillic";

describe("#163 транслитерация русских слов хангылем", () => {
  it.each([
    // примеры из prompts/translate.md
    ["Уштобе", "우슈토베"],
    ["Алматы", "알마티"],
    ["Талдыкорган", "탈디코르간"],
    ["Николай", "니콜라이"],
    ["Петрович", "페트로비치"],
    ["Лена", "레나"],
    // из ручной проверки #119
    ["Ерлан", "예를란"],
    ["ЗИЛ", "질"],
    ["Люда", "류다"],
    ["Володя", "볼로댜"],
    ["Аня", "아냐"],
    ["Жумабаевы", "주마바예비"],
    // ь, й, ш, двойные, оглушение
    ["Сергей", "세르게이"],
    ["Ольга", "올가"],
    ["Татьяна", "타티야나"],
    ["Наталья", "나탈리야"],
    ["Анна", "안나"],
    ["Алла", "알라"],
    ["Петров", "페트로프"],
    ["Фёдор", "표도르"],
    ["Саша", "사샤"],
    ["Москва", "모스크바"],
  ])("%s → %s", (ru, ko) => {
    expect(hangulizeRu(ru)).toBe(ko);
  });
});

describe("#163 кириллица в переводе главы", () => {
  it("словарное написание важнее транслитерации; дефис — одно слово; частицы остаются", () => {
    const { out, fixed } = fixCyrillic(
      { text_ko: "Ерлан이 ЗИЛ을 몰고 Иссык-Куль에 갔다.", title_ko: "Ерлан과 함께", quote_ko: "" },
      [{ ru: "Ерлан", ko: "에를란" }],
    );
    expect(out.text_ko).toBe("에를란이 질을 몰고 이시크쿨에 갔다.");
    expect(out.title_ko).toBe("에를란과 함께");
    expect(hasCyrillic(out.text_ko, out.title_ko, out.quote_ko)).toBe(false);
    expect(fixed.map((f) => f.how)).toEqual(["dict", "translit", "translit"]);
  });

  it("корейский текст без кириллицы не меняется", () => {
    const ko = { text_ko: "우슈토베에서 태어났다. 1963년.", title_ko: "시작", quote_ko: "고맙습니다" };
    expect(fixCyrillic(ko, []).out).toEqual(ko);
    expect(fixCyrillic(ko, []).fixed).toEqual([]);
  });
});
