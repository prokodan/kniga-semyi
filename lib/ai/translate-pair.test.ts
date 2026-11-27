import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { promptPath, promptVariant } from "./prompts";
import { inputSchemas, isTranslatePair, neutralTranslation, outputSchemas, translateInput } from "./types";

const input = { text_ru: "Глава", title: "Название", quote: "Цитата" };

describe("translate(from, to) (#230)", () => {
  it("ru → ko: вход как до v2 (ключ ai_cache и готовые переводы прежние)", () => {
    expect(translateInput("ru", "ko", input)).toEqual(input);
    expect(inputSchemas.translate.parse(translateInput("ru", "ko", input))).toEqual(input);
  });

  it("другая пара попадает во вход, а значит и в ключ кэша", () => {
    // #231: ru → kk и kk → ru есть; пары без промпта — ошибка, а не тихий корейский
    expect(isTranslatePair("ru", "kk")).toBe(true);
    expect(isTranslatePair("kk", "ru")).toBe(true);
    expect(translateInput("ru", "kk", input)).toEqual({ ...input, from: "ru", to: "kk" });
    expect(inputSchemas.translate.parse(translateInput("kk", "ru", input))).toMatchObject({ from: "kk", to: "ru" });
    expect(isTranslatePair("kk", "ko")).toBe(false);
    expect(() => translateInput("kk", "ko", input)).toThrow(/kk → ko/);
    expect(() => inputSchemas.translate.parse({ ...input, to: "xx" })).toThrow();
  });

  it("#231: промпт по языку `to`: kk → translate.kk.md, ru → translate.ru.md, без `to` — корейский", () => {
    expect(promptVariant("translate", { to: "kk" })).toBe("kk");
    expect(promptVariant("translate", { to: "ru" })).toBe("ru");
    expect(promptVariant("translate", input)).toBe("ko");
    expect(path.basename(promptPath("translate", undefined, "kk"))).toBe("translate.kk.md");
    expect(path.basename(promptPath("translate", undefined, "ru"))).toBe("translate.ru.md");
    // completeness: без next — прежний промпт (версия и кэш прода не меняются), с next — completeness.next.md
    expect(promptVariant("completeness", { answer: "a" })).toBeUndefined();
    expect(path.basename(promptPath("completeness", undefined, promptVariant("completeness", { answer: "a" })))).toBe("completeness.md");
    expect(path.basename(promptPath("completeness", undefined, promptVariant("completeness", { next: {} })))).toBe("completeness.next.md");
    expect(path.basename(promptPath("edit", undefined, "../x"))).toBe("edit.md");
  });

  it("#231: ответ перевода на kk / ru с ключами text / title / quote приводится к text_ko …", () => {
    const out = outputSchemas.translate.parse({ text: "Мен 1940 жылы туылдым.", title: "Т", quote: "Ц" });
    expect(out).toMatchObject({ text_ko: "Мен 1940 жылы туылдым.", title_ko: "Т", quote_ko: "Ц" });
    expect(outputSchemas.translate.parse({ text_ko: "글", title_ko: "", quote_ko: "" })).toMatchObject({ text_ko: "글" });
    expect(neutralTranslation({ text: "x" })).toEqual({ text_ko: "x", title_ko: "", quote_ko: "" });
    expect(outputSchemas.translate.safeParse({ title: "т" }).success).toBe(false);
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
