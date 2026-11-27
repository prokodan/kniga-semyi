// #298: защиты казахского перевода (алфавит, обращение к внукам, имена семьи) — чистые функции lib/pipeline/kk.ts.
import { describe, expect, it } from "vitest";
import translateKk from "@/fixtures/ai/translate.kk.json";
import editFixture from "@/fixtures/ai/edit.json";
import type { FamilyEntity } from "@/lib/types";
import {
  applySpellingsKk,
  finishKk,
  fixGrandkidsKk,
  fixKkScript,
  foldKk,
  grandkidsMixedKk,
  kkProblems,
  kzLatinToCyr,
  learnSpellingsKk,
  namesForTranslateKk,
  requiredSpellingsKk,
  spellingInKk,
} from "./kk";

const fixture = { text_ko: translateKk.text, title_ko: translateKk.title, quote_ko: translateKk.quote };

function entity(over: Partial<FamilyEntity> & { name_kk?: string | null }): FamilyEntity & { name_kk?: string | null } {
  return {
    id: "e1",
    family_id: "f1",
    kind: "person",
    name_ru: "Сауле",
    name_ko: null,
    description: null,
    story_ids: ["s1"],
    source: "auto",
    updated_at: "2026-11-28T00:00:00Z",
    ...over,
  };
}

describe("алфавит (#298 п. 1)", () => {
  it("находка со staging: «машинада da емес» → «да»; смешанное слово — двойники в кириллицу", () => {
    const r = fixKkScript("Байлық үйде де, машинада da емес. Ол кеlді, бiр күні.");
    expect(r.text).toBe("Байлық үйде де, машинада да емес. Ол келді, бір күні.");
    expect(r.fixed.map((f) => f.from)).toEqual(["da", "кеlді", "бiр"]);
  });

  it("казахская латиница 2021 по словам; заглавные (аббревиатуры, имена) и слова оригинала не трогаем", () => {
    expect(kzLatinToCyr("bir")).toBe("бір");
    expect(kzLatinToCyr("şeşem")).toBe("шешем");
    expect(kzLatinToCyr("qazaq")).toBe("қазақ");
    expect(fixKkScript("KGB туралы, Toyota мінді").fixed).toEqual([]);
    expect(fixKkScript("ол iphone алды", "Он купил iphone").fixed).toEqual([]);
  });

  it("фикстура заглушки — без изменений", () => {
    const r = finishKk(fixture, editFixture.text_ru);
    expect(r.out).toEqual(fixture);
    expect(r.fixed).toEqual([]);
    expect(r.left).toEqual({ latin: [], hangul: false, style: [] });
  });

  it("хангыль и латиница, которую не исправить, — остаются флажком", () => {
    const r = finishKk({ ...fixture, text_ko: `${fixture.text_ko} 우슈토베 KGB` }, editFixture.text_ru);
    expect(r.left.hangul).toBe(true);
    expect(r.left.latin).toEqual(["KGB"]);
    expect(kkProblems({ text: "машинада da емес" }).script).toEqual(["da"]);
  });
});

describe("обращение к внукам (#298 п. 2)", () => {
  const mixed = "Балаларым, бірге болыңдар, бір-біріңізге қамқор болыңыздар.";

  it("находка со staging: «болыңдар» и «бір-біріңізге» в одном абзаце — флажок; исправление — «сендер»", () => {
    expect(grandkidsMixedKk(mixed)).toEqual([{ paragraph: 1, familiar: "болыңдар", polite: "біріңізге" }]);
    const r = fixGrandkidsKk(mixed);
    expect(r.text).toBe("Балаларым, бірге болыңдар, бір-біріңе қамқор болыңдар.");
    expect(grandkidsMixedKk(r.text)).toEqual([]);
  });

  it("сіздерге → сендерге; только абзац со смешением; «теңіз» — не обращение", () => {
    const text = "Апа, сіздің үйіңізге бардық.\nНемерелерім, ұмытпаңдар, сіздерге айтам: теңізге барыңыздар.";
    const r = fixGrandkidsKk(text);
    expect(r.text).toBe("Апа, сіздің үйіңізге бардық.\nНемерелерім, ұмытпаңдар, сендерге айтам: теңізге барыңдар.");
    expect(grandkidsMixedKk("Біз теңізге бардық, балалар, біліңдер.")).toEqual([]);
  });

  it("к старшим на «Сіз» без обращения к внукам — не трогаем", () => {
    const t = "Әже, Сіз бізге айтыңызшы. Сіздердің үйіңізге келдік.";
    expect(grandkidsMixedKk(t)).toEqual([]);
    expect(fixGrandkidsKk(t).text).toBe(t);
  });
});

describe("имена семьи (#298 п. 3)", () => {
  it("foldKk: казахские буквы ↔ русские двойники", () => {
    expect(foldKk("Сәуле")).toBe(foldKk("Сауле"));
    expect(foldKk("Үштөбе")).toBe("уштобе");
  });

  it("написание имени в казахском тексте — с окончанием, самое частое; нет — null", () => {
    const text = "Сәуленің үйі Үштөбеде еді. Сәулеге хат жаздым. Алматыға бардық.";
    expect(spellingInKk(text, "Сауле")).toBe("Сәуле");
    expect(spellingInKk(text, "Уштобе")).toBe("Үштөбе");
    expect(spellingInKk(text, "Алма-Ата")).toBeNull();
    expect(spellingInKk("Анна Петровна келді.", "Анна Петровна")).toBe("Анна Петровна");
    // обычное слово с маленькой буквы — не имя
    expect(spellingInKk("сауле түсті", "Сауле")).toBeNull();
  });

  it("первая глава задаёт написание: учим только пустые name_kk и только имена этой главы", () => {
    const list = [entity({}), entity({ id: "e2", name_ru: "Ерлан", name_kk: "Ерлан" }), entity({ id: "e3", name_ru: "Уштобе", kind: "place", story_ids: ["s9"] })];
    expect(learnSpellingsKk(list, "Сәуле мен Ерлан Үштөбеде.", "s1")).toEqual([{ id: "e1", name_kk: "Сәуле" }]);
  });

  it("другой вариант имени в следующей главе → словарный (с окончанием); правка семьи — первой", () => {
    const req = requiredSpellingsKk([entity({ name_kk: "Сауле" }), entity({ id: "e2", name_kk: "Сәуле", source: "family" })]);
    expect(req).toEqual([{ ru: "Сауле", ko: "Сәуле" }]);
    const r = applySpellingsKk("Саулеге хат жаздым, Сауле келді. Саулетай — басқа адам.", req);
    expect(r.text).toBe("Сәулеге хат жаздым, Сәуле келді. Саулетай — басқа адам.");
    expect(r.fixed).toHaveLength(2);
  });

  it("во вход перевода — только люди и места с name_kk (поле ko = написание на языке перевода)", () => {
    const list = [entity({ name_kk: "Сәуле" }), entity({ id: "e2", name_ru: "Ерлан" }), entity({ id: "e3", kind: "word", name_ru: "кукси", name_kk: "кукси" })];
    expect(namesForTranslateKk(list)).toEqual([{ ru: "Сауле", ko: "Сәуле" }]);
  });
});
