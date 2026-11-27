import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveBank } from "../index";
import { GENERAL_QUESTIONS } from "../general/questions";
import { KZ_GLOSSARY } from "./glossary";
import { KZ_PACK } from "./pack";

const KK_LETTERS = /[әіңғүұқөһӘІҢҒҮҰҚӨҺ]/;

describe("пакет kz (#231): глоссарий для перевода ru ↔ kk", () => {
  const ruToKk = readFileSync("prompts/translate.kk.md", "utf8");

  it("каждое казахское слово глоссария есть в prompts/translate.kk.md (промпт и глоссарий не разъехались)", () => {
    for (const t of KZ_GLOSSARY) expect(ruToKk, t.kk).toContain(t.kk);
  });

  it("родство из issue на месте", () => {
    const kk = KZ_GLOSSARY.map((t) => t.kk);
    for (const w of ["әке", "апа", "шеше", "әже", "ата", "нағашы ата", "нағашы әже", "аға", "көке", "қарындас", "сіңлі", "келін", "күйеу бала", "немере", "шөбере"])
      expect(kk, w).toContain(w);
    expect(KZ_PACK.kinship?.length).toBeGreaterThanOrEqual(15);
  });

  it("термины без дублей; «не:» — не само слово; русские основы — в нижнем регистре", () => {
    const seen = new Set<string>();
    for (const t of KZ_GLOSSARY) {
      expect(seen.has(t.kk), t.kk).toBe(false);
      seen.add(t.kk);
      for (const n of t.not ?? []) expect(n, t.kk).not.toBe(t.kk);
      for (const r of t.ru) expect(r, t.kk).toBe(r.toLowerCase());
    }
  });

  it("казахские буквы в словах, где они есть в норме (ауыл, құрт, қымыз…)", () => {
    for (const w of ["ауыл", "құрт", "қымыз", "сырмақ", "Қарағанды"]) expect(KZ_GLOSSARY.find((t) => t.kk === w)?.kk, w).toMatch(/ауыл|[құ]/i);
    expect(KZ_GLOSSARY.filter((t) => KK_LETTERS.test(t.kk)).length).toBeGreaterThan(30);
  });

  it("#233: general + kz = костяк + вопросы слоя (вопросы — content/packs/culture.test.ts)", () => {
    const ids = resolveBank(["general", "kz"], "ru").map((q) => q.id);
    for (const q of GENERAL_QUESTIONS) expect(ids, q.id).toContain(q.id);
    expect(ids.length).toBeGreaterThan(GENERAL_QUESTIONS.length);
  });
});
