// #353: подписи /review 2.0 — все ключи на ko / kk / ru, якоря 1 / 3 / 5 у 5 критериев, пример по языку перевода,
// пометка «вычитать носителю (#258)» на корейских и казахских строках.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CRITERIA, UI_LANGS } from "@/app/admin/quality/checks/_lib/core";
import { checkDictionary, closedText } from "./checks-strings";

describe("подписи /review 2.0", () => {
  it("каждая строка есть на каждом языке; не ru — ещё и по-русски", () => {
    for (const lang of UI_LANGS) {
      const { strings, crit } = checkDictionary(lang, "ko");
      for (const [k, v] of Object.entries(strings)) {
        expect(v.native.trim(), `${lang}.${k}`).not.toBe("");
        if (lang !== "ru") expect(v.ru.trim(), `${lang}.${k} ru`).not.toBe("");
      }
      for (const c of CRITERIA) for (const f of ["label", "a1", "a3", "a5"] as const) expect(crit[c][f].native.trim(), `${lang}.${c}.${f}`).not.toBe("");
    }
  });

  it("«что нужно» — 3 пункта на оба режима, время с подстановкой", () => {
    const { strings } = checkDictionary("kk", "kk");
    for (const k of ["needText1", "needText2", "needText3", "needTerms1", "needTerms2", "needTerms3"] as const) expect(strings[k].native).toBeTruthy();
    expect(strings.time.native).toContain("{a}");
  });

  it("пример хорошей проверки — на языке перевода, правка отличается от модели", () => {
    for (const to of ["ko", "kk"] as const) {
      const { example } = checkDictionary("ru", to);
      expect(example.fixed).not.toBe(example.model);
      expect(example.model).toContain(example.term.term);
      expect(example.why.native).toBeTruthy();
    }
    expect(checkDictionary("ko", "ko").example.model).toMatch(/[가-힣]/);
    expect(checkDictionary("kk", "kk").example.model).toMatch(/[әіңғүұқөһ]/i);
  });

  it("ссылка закрыта — текст на языке проверяющего и по-русски", () => {
    expect(closedText("expired", "kk")).toHaveLength(2);
    expect(closedText("invalid", null).length).toBe(3);
  });

  it("корейские и казахские строки помечены «вычитать носителю (#258)»", () => {
    const src = readFileSync(path.join(process.cwd(), "app/review/_lib/checks-strings.ts"), "utf8");
    expect(src.match(/вычитать носителю \(#258\)/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
  });
});
