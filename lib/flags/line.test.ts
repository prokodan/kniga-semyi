// #223: CI flag-line — строка «Флаг:» в описании PR.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkFlagLine, checkPullRequest, isDocsOnly } from "./line";

const KNOWN = ["demo_flag", "new_book"];

describe("строка «Флаг:»", () => {
  it("имя из реестра", () => {
    expect(checkFlagLine("Closes #1\n\nФлаг: demo_flag\n", KNOWN)).toEqual({ ok: true, kind: "flags", names: ["demo_flag"] });
    expect(checkFlagLine("**Флаг:** `new_book`", KNOWN)).toEqual({ ok: true, kind: "flags", names: ["new_book"] });
    expect(checkFlagLine("- Флаг: demo_flag, new_book", KNOWN)).toMatchObject({ ok: true, names: ["demo_flag", "new_book"] });
  });

  it("«не нужен — причина» (тире любое)", () => {
    expect(checkFlagLine("Флаг: не нужен — инфраструктура флагов", KNOWN)).toEqual({ ok: true, kind: "none", reason: "инфраструктура флагов" });
    expect(checkFlagLine("флаг: Не нужен - багфикс", KNOWN)).toMatchObject({ ok: true, kind: "none", reason: "багфикс" });
    expect(checkFlagLine("Флаг: не нужен – docs", KNOWN)).toMatchObject({ ok: true, kind: "none" });
  });

  it("красный: нет строки, пустой шаблон, без причины, неизвестный флаг, две строки", () => {
    expect(checkFlagLine("Closes #1", KNOWN).ok).toBe(false);
    expect(checkFlagLine(null, KNOWN).ok).toBe(false);
    const template = readFileSync(".github/pull_request_template.md", "utf8");
    expect(checkFlagLine(template, KNOWN).ok).toBe(false);
    expect(checkFlagLine("Флаг: не нужен", KNOWN)).toMatchObject({ ok: false, error: expect.stringContaining("без причины") });
    expect(checkFlagLine("Флаг: new_bok", KNOWN)).toMatchObject({ ok: false, error: expect.stringContaining("new_bok") });
    expect(checkFlagLine("Флаг: demo_flag\nФлаг: new_book", KNOWN)).toMatchObject({ ok: false, error: expect.stringContaining("несколько") });
  });

  it("заполненный шаблон проходит", () => {
    const template = readFileSync(".github/pull_request_template.md", "utf8");
    const filled = template.replace(/^Флаг:.*$/m, "Флаг: demo_flag");
    expect(checkFlagLine(filled, KNOWN)).toMatchObject({ ok: true, kind: "flags" });
  });
});

describe("пропуски", () => {
  it("Dependabot и только документация — пропуск", () => {
    expect(checkPullRequest({ author: "dependabot[bot]", body: "", files: ["package.json"] }, KNOWN)).toMatchObject({ kind: "skip" });
    expect(checkPullRequest({ author: "danil", body: "", files: ["docs/HANDOFF.md", "AGENTS.md"] }, KNOWN)).toMatchObject({ kind: "skip" });
  });

  it("prompts/*.md и код — не документация", () => {
    expect(isDocsOnly(["prompts/edit.md"])).toBe(false);
    expect(isDocsOnly(["docs/STATUS.md", "lib/flags/index.ts"])).toBe(false);
    expect(isDocsOnly([])).toBe(false);
    expect(checkPullRequest({ author: "danil", body: "", files: ["docs/STATUS.md", "app/page.tsx"] }, KNOWN).ok).toBe(false);
  });
});
