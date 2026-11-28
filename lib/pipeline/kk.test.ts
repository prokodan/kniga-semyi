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
  fixRussianKk,
  foldKk,
  grandkidsMixedKk,
  kkLeftCount,
  kkProblems,
  kkRetryNote,
  kzLatinToCyr,
  learnSpellingsKk,
  namesForTranslateKk,
  requiredSpellingsKk,
  russianLeftKk,
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
    expect(r.left).toEqual({ latin: [], hangul: false, style: [], russian: [] });
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

describe("русские слова в казахском переводе (#315)", () => {
  const ru = "Дома были глинобитные. Было трудно, но мы, конечно, жили в ауле.";
  const kk = "Үйлер глинобитные еді. Қиын было, но біз, конечно, аулда тұрдық.";

  it("находка eval serik: «было», «но», «конечно», «глинобитные» — флажок russian", () => {
    expect(russianLeftKk(kk, ru)).toEqual(["глинобитные", "было", "но", "конечно"]);
  });

  it("однозначные служебные слова и «аул» — по-казахски без ИИ; «было» и «глинобитные» — остаются флажком", () => {
    const r = fixRussianKk(kk, ru);
    expect(r.text).toBe("Үйлер глинобитные еді. Қиын было, бірақ біз, әрине, ауылда тұрдық.");
    expect(r.fixed.map((f) => `${f.from}→${f.to}`)).toEqual(["но→бірақ", "конечно→әрине", "аулда→ауылда"]);
    expect(fixRussianKk("Но біз келдік. Аул алыс.").text).toBe("Бірақ біз келдік. Ауыл алыс.");
  });

  it("казахские слова не трогаем: «не», «он», «да», «там», «мен», «аулақ», «аулау»; имена и советские реалии — не русские", () => {
    const ok = "Не істейміз? Он бала мен әжем. Там салдық, аулақта аулау да болды.";
    expect(russianLeftKk(ok, "Что делать? Десять детей.")).toEqual([]);
    expect(fixRussianKk(ok).fixed).toEqual([]);
    expect(russianLeftKk("Колхоз бригадирі Николай Петрович келді, трактор әкелді.", "Пришёл бригадир колхоза Николай Петрович, привёз трактор.")).toEqual([]);
    // корё мар оригинала (кукси, аппади) — как в оригинале, не русские слова
    expect(russianLeftKk(translateKk.text, editFixture.text_ru)).toEqual([]);
  });

  it("finishKk: русские служебные исправлены, остаток — в left.russian", () => {
    const r = finishKk({ ...fixture, text_ko: kk }, ru);
    expect(r.out.text_ko).toContain("бірақ біз, әрине, ауылда");
    expect(r.left.russian).toEqual(["глинобитные", "было"]);
  });
});

describe("замечание к повтору перевода (#313)", () => {
  const none = { latin: [], hangul: false, style: [], russian: [] };

  it("нечего повторять — null (обращение к внукам — не повод для повтора: его чинит fixGrandkidsKk)", () => {
    expect(kkRetryNote(none)).toBeNull();
    expect(kkRetryNote({ ...none, style: [{ paragraph: 1, familiar: "болыңдар", polite: "біріңізге" }] })).toBeNull();
  });

  it("хангыль, латиница с заглавной, русские слова — в замечании; текст тот же при том же остатке (ключ кэша)", () => {
    const left = { ...none, hangul: true, latin: ["KGB"], russian: ["было"] };
    const note = kkRetryNote(left)!;
    expect(note).toContain("хангыль");
    expect(note).toContain("KGB");
    expect(note).toContain("было");
    expect(note.length).toBeLessThanOrEqual(600);
    expect(kkRetryNote({ ...left })).toBe(note);
    expect(kkLeftCount(left)).toBe(3);
  });
});
