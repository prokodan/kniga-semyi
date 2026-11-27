import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { promptPath } from "./prompts";
import { inputSchemas, isTranslatePair, translateInput } from "./types";

const input = { text_ru: "Глава", title: "Название", quote: "Цитата" };

describe("translate(from, to) (#230)", () => {
  it("ru → ko: вход как до v2 (ключ ai_cache и готовые переводы прежние)", () => {
    expect(translateInput("ru", "ko", input)).toEqual(input);
    expect(inputSchemas.translate.parse(translateInput("ru", "ko", input))).toEqual(input);
  });

  it("другая пара попадает во вход, а значит и в ключ кэша", () => {
    expect(isTranslatePair("ru", "kk")).toBe(false);
    expect(() => translateInput("ru", "kk", input)).toThrow(/ru → kk/);
    // когда пара появится (L1), её поля уйдут в stableStringify(input) — проверяем, что схема их пропускает
    expect(inputSchemas.translate.parse({ ...input, from: "ru", to: "kk" })).toMatchObject({ from: "ru", to: "kk" });
    expect(() => inputSchemas.translate.parse({ ...input, to: "xx" })).toThrow();
  });

  it("промпт перевода на корейский — prompts/translate.ko.md, текст прежнего translate.md", () => {
    const file = promptPath("translate");
    expect(path.basename(file)).toBe("translate.ko.md");
    expect(readFileSync(file, "utf8")).toMatch(/text_ko/);
  });

  it("нет translate.<to>.md (дерево «до» в eval из базовой ветки) — prompts/translate.md", () => {
    const root = mkdtempSync(path.join(tmpdir(), "prompts-"));
    mkdirSync(path.join(root, "prompts"));
    writeFileSync(path.join(root, "prompts", "translate.md"), "old");
    expect(path.basename(promptPath("translate", root))).toBe("translate.md");
    writeFileSync(path.join(root, "prompts", "translate.ko.md"), "new");
    expect(path.basename(promptPath("translate", root))).toBe("translate.ko.md");
    expect(path.basename(promptPath("edit", root))).toBe("edit.md");
  });
});
