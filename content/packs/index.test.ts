import { describe, expect, it } from "vitest";
import { LIFE_BLOCKS } from "@/lib/types";
import { QUESTIONS } from "@/content/questions/bank";
import snapshot from "./bank-v0.snapshot.json";
import { GENERAL_QUESTIONS } from "./general/questions";
import { CULTURE_PACKS, applyPacks, resolveBank } from "./index";
import type { CulturePack, PackQuestion } from "./types";

const pick = (qs: { id: string; block: string; ru: string; ko: string; minimum: string[] }[]) =>
  qs.map(({ id, block, ru, ko, minimum }) => ({ id, block, ru, ko, minimum }));

describe("resolveBank: general + koryo = сегодняшний банк (#230)", () => {
  it("id, порядок, ru, ko, minimum — как в банке V0 до v2 (снимок)", () => {
    expect(pick(resolveBank(["general", "koryo"], "ru"))).toEqual(snapshot);
  });

  it("QUESTIONS (то, что слышат семьи) = снимок V0", () => {
    expect(pick(QUESTIONS)).toEqual(snapshot);
  });

  it("корё мар в рассказе ведёт себя как ru; general добавляется сам; повтор слоя не меняет банк", () => {
    const base = pick(resolveBank(["general", "koryo"], "ru"));
    expect(pick(resolveBank(["general", "koryo"], "koryo"))).toEqual(base);
    expect(pick(resolveBank(["koryo"], "ru"))).toEqual(base);
    expect(pick(resolveBank(["general", "koryo", "koryo"], "ru"))).toEqual(base);
  });

  it("неизвестный слой пропускается (семья с пакетом, которого ещё нет в коде)", () => {
    expect(pick(resolveBank(["general", "nope", "koryo"], "ru"))).toEqual(snapshot);
  });

  it("только general — 40 вопросов без реалий корё-сарам", () => {
    const g = resolveBank(["general"], "ru");
    expect(g.map((q) => q.id)).toEqual(snapshot.map((q) => q.id));
    expect(g.map((q) => q.ru).join(" ")).not.toMatch(/корё|корейск|чимчи|кукси|асянди|1937/i);
  });

  it("нет текста для языка рассказа → ошибка (kk ещё не написан)", () => {
    expect(() => resolveBank(["general", "koryo"], "kk")).toThrow(/нет текста «kk»/);
  });
});

describe("пакеты: целостность", () => {
  it("general: id уникальны, вида <block>-NN, все блоки, ru и ko у каждого", () => {
    const ids = GENERAL_QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const q of GENERAL_QUESTIONS) {
      expect(q.id).toMatch(new RegExp(`^${q.block}-\\d{2}$`));
      expect(q.text.ru.length, q.id).toBeGreaterThan(10);
      expect(q.text.ko?.length ?? 0, q.id).toBeGreaterThan(5);
    }
    for (const b of LIFE_BLOCKS) expect(GENERAL_QUESTIONS.some((q) => q.block === b), b).toBe(true);
  });

  it("у каждого слоя операции ссылаются на существующие вопросы (applyPacks не бросает)", () => {
    for (const pack of Object.values(CULTURE_PACKS)) expect(() => applyPacks(GENERAL_QUESTIONS, [pack]), pack.id).not.toThrow();
  });

  it("трудные темы слоёв — только в hardship", () => {
    for (const pack of Object.values(CULTURE_PACKS))
      for (const s of pack.sensitive ?? []) for (const id of s.questionIds ?? []) expect(id, pack.id).toMatch(/^hardship-/);
  });
});

describe("applyPacks: операции и правило конфликта", () => {
  const q = (id: string, ru: string): PackQuestion => ({ id, block: "roots", text: { ru, ko: `${ru}-ko` }, minimum: ["кто"] });
  const base = [q("roots-01", "A"), q("roots-02", "B"), q("roots-03", "C")];
  const layer = (id: string, ops: CulturePack["ops"]): CulturePack => ({ id, title: id, ops });

  it("add — сразу после якоря, несколько add к одному якорю — по порядку", () => {
    const out = applyPacks(base, [
      layer("x", [{ op: "add", after: "roots-01", question: q("roots-11", "X1") }]),
      layer("y", [{ op: "add", after: "roots-01", question: q("roots-12", "Y1") }]),
    ]);
    expect(out.map((x) => x.id)).toEqual(["roots-01", "roots-11", "roots-12", "roots-02", "roots-03"]);
  });

  it("reword, minimum+, hide", () => {
    const out = applyPacks(base, [
      layer("x", [
        { op: "reword", id: "roots-02", text: { ru: "B2" } },
        { op: "minimum+", id: "roots-02", add: ["род", "кто"] },
        { op: "hide", id: "roots-03" },
      ]),
    ]);
    expect(out.map((x) => x.id)).toEqual(["roots-01", "roots-02"]);
    expect(out[1]).toMatchObject({ text: { ru: "B2", ko: "B-ko" }, minimum: ["кто", "род"] });
  });

  it("два слоя переформулируют один вопрос → первый слой, второй — вопрос сразу после (оба прозвучат)", () => {
    const out = applyPacks(base, [
      layer("kz", [{ op: "reword", id: "roots-02", text: { ru: "Наурыз" } }]),
      layer("ua", [{ op: "reword", id: "roots-02", text: { ru: "Коляда" } }]),
    ]);
    expect(out.map((x) => [x.id, x.text.ru])).toEqual([
      ["roots-01", "A"],
      ["roots-02", "Наурыз"],
      ["roots-02-ua", "Коляда"],
      ["roots-03", "C"],
    ]);
  });

  it("битый якорь / id / повтор id — ошибка", () => {
    expect(() => applyPacks(base, [layer("x", [{ op: "add", after: "nope", question: q("roots-09", "Z") }])])).toThrow(/нет вопроса nope/);
    expect(() => applyPacks(base, [layer("x", [{ op: "hide", id: "nope" }])])).toThrow();
    expect(() => applyPacks(base, [layer("x", [{ op: "add", after: "roots-01", question: q("roots-02", "Z") }])])).toThrow(/повтор/);
  });

  it("костяк не мутируется", () => {
    applyPacks(base, [layer("x", [{ op: "reword", id: "roots-01", text: { ru: "Z" } }, { op: "minimum+", id: "roots-01", add: ["m"] }])]);
    expect(base[0]).toEqual(q("roots-01", "A"));
  });
});
