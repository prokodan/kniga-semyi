// #233: культурные пакеты — костяк general (ru, ko, kk) + слои kz / koryo / ua: несколько слоёв на семью, правило
// конфликта reword на настоящих пакетах, трудные темы, «Сіз», без чужих этнических реалий.
import { describe, expect, it } from "vitest";
import snapshot from "./bank-v0.snapshot.json";
import { GENERAL_QUESTIONS } from "./general/questions";
import { CULTURE_PACKS, applyPacks, isDefaultPacks, normalizePacks, packKinship, packSensitive, packTone, resolveBank } from "./index";
import type { PackQuestion } from "./types";

/** Слова «на ты» по-казахски — в вопросах к старшим недопустимы (tone kz). */
const KK_INFORMAL = new Set(["сен", "сенің", "саған", "сені", "сенде", "сенен", "сенімен", "сенсің", "сендер"]);
const words = (s: string) => s.toLowerCase().split(/[^\p{L}-]+/u).filter(Boolean);
/** Разрешение не отвечать — как в hardship-02 / 03 / 04 костяка. */
const PERMISSION = /можно не отвечать|можно пропустить|можно и не отвечать|только то, чем хочется поделиться/;
const KORYO_REALIA = /корё|корейск|чимчи|кукси|асянди|хвангаб|ханщи|1937/i;
const KZ_REALIA = /наурыз|жеті|нағашы|жайлау|жуз|ашаршылық|желтоқсан|(^|[^а-яё])той([^а-яё]|$)/i;

/** Все вопросы, которые вносят слои (add и reword). */
function layerQuestions(packId: string): PackQuestion[] {
  return applyPacks(GENERAL_QUESTIONS, [CULTURE_PACKS[packId]!]).filter((q) => {
    const base = GENERAL_QUESTIONS.find((g) => g.id === q.id);
    return !base || base.text.ru !== q.text.ru;
  });
}

describe("general: тексты kk (#233)", () => {
  it("у каждого вопроса костяка есть kk с казахскими буквами или кириллицей, без «сен…»", () => {
    for (const q of GENERAL_QUESTIONS) {
      expect(q.text.kk?.trim().length ?? 0, q.id).toBeGreaterThan(8);
      for (const w of words(q.text.kk!)) expect(KK_INFORMAL.has(w), `${q.id}: «${w}»`).toBe(false);
    }
    expect(GENERAL_QUESTIONS.filter((q) => /[әіңғүұқөһ]/i.test(q.text.kk!)).length).toBeGreaterThan(30);
  });

  it("разрешение не отвечать на трудных вопросах костяка есть и в kk", () => {
    for (const id of ["hardship-02", "hardship-03", "hardship-04"]) {
      const kk = GENERAL_QUESTIONS.find((q) => q.id === id)!.text.kk!;
      expect(kk, id).toMatch(/жауап бермеуге|өткізіп жіберуге|бөліскіңіз келгенін ғана/);
    }
  });

  it("общий пакет по-казахски собирается (40 вопросов), корё-слой по-казахски — пока нет (тексты kk у koryo не писали)", () => {
    expect(resolveBank(["general"], "kk")).toHaveLength(40);
    expect(() => resolveBank(["general", "koryo"], "kk")).toThrow(/нет текста «kk»/);
  });
});

describe("слои: несколько на семью (#233)", () => {
  it("general + kz: вопросы слоя на своих местах, костяк целиком, порядок", () => {
    const ids = resolveBank(["general", "kz"], "ru").map((q) => q.id);
    expect(ids.slice(0, 7)).toEqual(["roots-01", "roots-02", "roots-03", "roots-04", "roots-kz-01", "roots-kz-02", "roots-05"]);
    expect(ids.indexOf("childhood-kz-01")).toBe(ids.indexOf("childhood-03") + 1);
    expect(ids.slice(ids.indexOf("hardship-03"), ids.indexOf("hardship-03") + 3)).toEqual(["hardship-03", "hardship-kz-01", "hardship-kz-02"]);
    for (const q of GENERAL_QUESTIONS) expect(ids, q.id).toContain(q.id);
    expect(ids).toHaveLength(GENERAL_QUESTIONS.length + 5);
  });

  it("general + kz по-казахски тоже собирается (у каждого вопроса слоя есть kk)", () => {
    const kk = resolveBank(["general", "kz"], "kk");
    expect(kk.every((q) => q.kk && q.kk.length > 8)).toBe(true);
    expect(kk.find((q) => q.id === "traditions-03")!.kk).toMatch(/Наурыз/);
  });

  it("reword заменяет тексты целиком: у kz-вопросов нет корейского, ru и kk про одно", () => {
    const bank = resolveBank(["general", "kz"], "ru");
    const t3 = bank.find((q) => q.id === "traditions-03")!;
    expect(t3.ru).toMatch(/Наурыз/);
    expect(t3.ko).toBe("");
    expect(bank.find((q) => q.id === "roots-01")!.minimum).toContain("род (ру), если помнит");
  });

  it("general + kz + ua: три слоя вместе; конфликт reword traditions-03 — kz первым, ua вопросом после", () => {
    const bank = resolveBank(["general", "kz", "ua"], "ru");
    const i = bank.findIndex((q) => q.id === "traditions-03");
    expect(bank[i]!.ru).toMatch(/Наурыз/);
    expect(bank[i + 1]).toMatchObject({ id: "traditions-03-ua", block: "traditions" });
    expect(bank[i + 1]!.ru).toMatch(/украинск/);
    // ua без конфликта — обычный reword
    expect(bank.find((q) => q.id === "traditions-01")!.ru).toMatch(/украинские блюда/);
  });

  it("порядок слоёв решает: ua + kz — первым ua, Наурыз вопросом после", () => {
    const bank = resolveBank(["general", "ua", "kz"], "ru");
    const i = bank.findIndex((q) => q.id === "traditions-03");
    expect(bank[i]!.ru).toMatch(/украинск/);
    expect(bank[i + 1]).toMatchObject({ id: "traditions-03-kz" });
    expect(bank[i + 1]!.ru).toMatch(/Наурыз/);
  });

  it("koryo + ua: оба переформулируют traditions-01 и legacy-04 → прозвучат оба, корё первым", () => {
    const bank = resolveBank(["general", "koryo", "ua"], "ru");
    const ids = bank.map((q) => q.id);
    expect(ids[ids.indexOf("traditions-01") + 1]).toBe("traditions-01-ua");
    expect(ids[ids.indexOf("legacy-04") + 1]).toBe("legacy-04-ua");
    expect(bank.find((q) => q.id === "traditions-01")!.ru).toMatch(/корейские/);
    expect(bank.find((q) => q.id === "legacy-04-ua")!.ru).toMatch(/украинских/);
  });

  it("добавление слоёв не трогает general + koryo (снимок V0) и не меняет id костяка", () => {
    const pick = resolveBank(["general", "koryo"], "ru").map(({ id, block, ru, ko, minimum }) => ({ id, block, ru, ko, minimum }));
    expect(pick).toEqual(snapshot);
  });

  it("без чужих реалий: general / general+kz / general+ua — без корё; general+koryo / general+ua — без казахских", () => {
    const ru = (packs: string[]) => resolveBank(packs, "ru").map((q) => q.ru).join(" \n");
    for (const packs of [["general"], ["general", "kz"], ["general", "ua"]]) expect(ru(packs), packs.join("+")).not.toMatch(KORYO_REALIA);
    for (const packs of [["general"], ["general", "koryo"], ["general", "ua"]]) expect(ru(packs), packs.join("+")).not.toMatch(KZ_REALIA);
  });
});

describe("слои: правила контента (#233)", () => {
  const ALL = Object.keys(CULTURE_PACKS);

  it("трудные темы: только в hardship, не первым вопросом раздела, с разрешением не отвечать", () => {
    for (const id of ALL) {
      const bank = resolveBank(["general", id], "ru");
      const hardship = bank.filter((q) => q.block === "hardship");
      for (const s of CULTURE_PACKS[id]!.sensitive ?? [])
        for (const qid of s.questionIds ?? []) {
          const q = bank.find((x) => x.id === qid);
          expect(q, `${id}: ${qid}`).toBeDefined();
          expect(q!.block, `${id}: ${qid}`).toBe("hardship");
          expect(hardship[0]!.id, `${id}: ${qid} первым`).not.toBe(qid);
          expect(q!.ru, `${id}: ${qid}`).toMatch(PERMISSION);
        }
    }
  });

  it("вопросы, которые добавляют слои: id <блок>-<слой>-NN, есть ru; у kz — ещё kk на «Сіз»", () => {
    for (const id of ALL) {
      for (const op of CULTURE_PACKS[id]!.ops) if (op.op === "add") expect(op.question.id, id).toMatch(new RegExp(`^${op.question.block}-${id}-\\d{2}$`));
      for (const q of layerQuestions(id)) expect(q.text.ru.length, `${id}: ${q.id}`).toBeGreaterThan(10);
    }
    for (const q of layerQuestions("kz")) {
      expect(q.text.kk?.length ?? 0, q.id).toBeGreaterThan(8);
      for (const w of words(q.text.kk!)) expect(KK_INFORMAL.has(w), `${q.id}: «${w}»`).toBe(false);
    }
  });

  it("черновые слои помечены draft со ссылкой на issue (флаг семьям не включаем, пока draft)", () => {
    for (const id of ALL) {
      const d = CULTURE_PACKS[id]!.draft;
      if (d) expect(d, id).toMatch(/#\d+/);
    }
    expect(CULTURE_PACKS.koryo!.draft).toBeUndefined();
  });
});

describe("пакеты семьи: помощники сервиса (#233)", () => {
  it("normalizePacks: general первым, без повторов и неизвестных; isDefaultPacks", () => {
    expect(normalizePacks(["kz", "general", "kz", "nope", "ua"])).toEqual(["general", "kz", "ua"]);
    expect(normalizePacks(null)).toEqual(["general"]);
    expect(isDefaultPacks(["general", "koryo"])).toBe(true);
    expect(isDefaultPacks(["koryo"])).toBe(true);
    expect(isDefaultPacks(["general", "koryo", "kz"])).toBe(false);
    expect(isDefaultPacks(["general"])).toBe(false);
  });

  it("родство, трудные темы, тон — по слоям семьи, в их порядке", () => {
    const kin = packKinship(["general", "kz", "koryo"]);
    expect(kin.find((k) => k.term === "нағашы ата")).toMatchObject({ pack: "kz" });
    expect(kin.find((k) => k.term === "аппади")).toMatchObject({ pack: "koryo" });
    expect(kin.findIndex((k) => k.pack === "kz")).toBeLessThan(kin.findIndex((k) => k.pack === "koryo"));
    expect(packKinship(["general"])).toEqual([]);
    expect(packSensitive(["general", "kz"]).map((s) => s.questionIds).flat()).toEqual(["hardship-kz-01", "hardship-kz-02"]);
    expect(packTone(["general", "kz"]).join(" ")).toMatch(/Сіз/);
  });
});
