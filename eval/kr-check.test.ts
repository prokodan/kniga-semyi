import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { QUESTIONS } from "@/content/questions/bank";
import { DEMO_ENTITIES } from "@/fixtures/demo/family";
import { DEMO_STORIES } from "@/lib/book/pdf/demo";
import { createRouter } from "@/lib/ai/router";
import { MemoryStore } from "@/lib/ai/store";
import {
  backTranslate,
  bieupFlags,
  checkItem,
  FAMILIES_NOTE,
  glossaryEquivalent,
  chooseBackMode,
  grandkidsHaeyo,
  isHapsyo,
  nameSpellingFlags,
  parseGlossary,
  pickForHuman,
  renderKrReport,
  variantRegex,
  withoutGlossaryNoise,
  yearsKo,
  yearsRu,
  type KrItem,
} from "./kr-check";

const glossary = parseGlossary(readFileSync("docs/glossary.md", "utf8"));
const chapter = (text_ru: string, text_ko: string, extra: Partial<KrItem> = {}): KrItem => ({
  id: "c1",
  kind: "chapter",
  label: "Глава 1",
  text_ru,
  text_ko,
  ...extra,
});
const rules = (i: KrItem) => checkItem(i, glossary).map((f) => f.rule);

describe("глоссарий docs/glossary.md", () => {
  it("≥ 30 слов корё мар и реалий, топонимы и фамилии из критериев V2", () => {
    expect(glossary.filter((g) => g.section === "koryo" || g.section === "realia").length).toBeGreaterThanOrEqual(30);
    const ko = (ru: string) => glossary.find((g) => g.ru.some((v) => variantRegex(v, true).test(ru)))?.ko;
    expect(ko("Уштобе")).toContain("우슈토베");
    expect(ko("Кзыл-Орда")).toContain("크질오르다");
    expect(ko("Алматы")).toContain("알마티");
    expect(ko("Ташкент")).toContain("타슈켄트");
    for (const w of ["кукси", "чимчи", "пигоди", "хансик", "асянди"]) expect(ko(w), w).toBeTruthy();
  });

  it("скобки в корейской колонке — пояснение, `*` — начало слова, регистр у топонимов", () => {
    expect(glossary.find((g) => g.ru.includes("хансик"))?.ko).toEqual(["한식"]);
    expect(variantRegex("колхоз*", false).test("работал в колхозе")).toBe(true);
    expect(variantRegex("пап", false).test("мой папа")).toBe(false);
    expect(variantRegex("Дальнем", true).test("в дальнем углу")).toBe(false);
  });
});

describe("правила без ИИ", () => {
  it("корё мар без эквивалента, топоним — major", () => {
    expect(rules(chapter("Мама варила кукси.", "어머니가 라면을 끓이셨다."))).toContain("glossary:koryo");
    const f = checkItem(chapter("Я родился в Уштобе.", "나는 우스토베에서 태어났다."), glossary);
    expect(f.find((x) => x.rule === "glossary:place")?.severity).toBe("major");
  });

  it("колхоз при первом упоминании — с пояснением", () => {
    expect(rules(chapter("Отец работал в колхозе.", "아버지는 콜호스에서 일하셨다."))).toContain("glossary:first-mention");
    expect(rules(chapter("Отец работал в колхозе.", "아버지는 콜호스(집단농장)에서 일하셨다."))).not.toContain("glossary:first-mention");
  });

  it("годы цифрами и словами", () => {
    expect([...yearsRu("В тридцать седьмом году, а в шестьдесят третьем — свадьба; в 1972 — орден")].sort()).toEqual([1937, 1963, 1972]);
    expect([...yearsRu("в сороковом году, сорок лет на полях, двадцать пять человек")]).toEqual([1940]);
    expect([...yearsKo("1963년에 만났다")]).toEqual([1963]);
    expect(rules(chapter("В шестьдесят третьем мы поженились.", "1964년에 결혼했다."))).toEqual(["year", "year"]);
  });

  it("стиль: 습니다체, 그녀, без -시- о старших, кириллица, цитата", () => {
    expect(isHapsyo("살았습니다")).toBe(true);
    expect(isHapsyo("아닙니다")).toBe(true);
    expect(isHapsyo("것이 아니다")).toBe(false);
    expect(rules(chapter("Мы жили бедно.", "우리는 가난하게 살았습니다."))).toContain("style:hapsyo");
    expect(rules(chapter("Я увидел её.", "그녀를 보았다."))).toContain("style:geunyeo");
    expect(rules(chapter("Отец работал.", "아버지는 일했다."))).toContain("style:honorific");
    expect(rules(chapter("Отец работал.", "아버지는 일하셨다."))).not.toContain("style:honorific");
    expect(rules(chapter("Был колхоз.", "콜호스 Колхоз"))).toContain("cyrillic");
    expect(rules(chapter("Да.", "그랬다.", { quote_ko: "아니었다." }))).toContain("quote");
  });

  it("прямая речь в кавычках не считается смешением стилей", () => {
    expect(rules(chapter("Мама сказала: учись.", "\"공부해요.\" 어머니는 그렇게 말씀하셨다. 나는 공부했다."))).not.toContain("style:mixed");
    expect(rules(chapter("Я жил. Послушайте.", "나는 살았다. 여러분, 들어 봐요."))).toContain("style:mixed");
  });

  it("#103: пояснения в скобках, которых нет в оригинале — major; глоссарные — можно", () => {
    const f = checkItem(chapter("Мы жили в доме аппади.", "우리는 아파디 우리(아버지의 집)에서 살았다. 아버지는 웃으셨다."), glossary);
    expect(f.find((x) => x.rule === "paren")).toMatchObject({ ko: "우리(아버지의 집)", severity: "major" });
    expect(rules(chapter("Пришёл аджибай.", "아지바이(아버지)가 오셨다."))).toEqual(expect.arrayContaining(["paren", "glossary:koryo"]));
    expect(rules(chapter("Отец работал в колхозе.", "아버지는 콜호스(집단농장)에서 일하셨다."))).not.toContain("paren");
    expect(rules(chapter("На хансик ездили к отцу.", "한식(寒食)에는 아버지께 갔다."))).not.toContain("paren");
    // скобки есть в оригинале — переводятся, не флажок
    expect(rules(chapter("Тётя Валя (мамина сестра) приехала.", "발랴 이모(어머니의 언니)가 오셨다."))).not.toContain("paren");
  });

  it("#103: вариант «не:» из глоссария — флажок glossary:variant", () => {
    const g = parseGlossary("## Корё мар\n| RU | 한국어 | Пояснение | Носитель |\n| --- | --- | --- | --- |\n| аппади | 아버지 | отец; не: 아버님 / 아빠 | ❓ |\n");
    expect(g[0]!.avoid).toEqual(["아버님", "아빠"]);
    const f = checkItem(chapter("Аппади работал.", "아버님은 일하셨다. 아버지는 웃으셨다."), g);
    expect(f.map((x) => x.rule).filter((r) => r.startsWith("glossary"))).toEqual(["glossary:variant"]);
    expect(f[0]!.issue).toContain("не 아버님");
    // нет эквивалента вовсе — и вариант, и отсутствие
    expect(checkItem(chapter("Аппади работал.", "아버님은 일하셨다."), g).map((x) => x.rule).filter((r) => r.startsWith("glossary"))).toEqual(["glossary:variant", "glossary:koryo"]);
  });

  it("#103: в docs/glossary.md аппади / омани — не: 아버님 / 어머님, аджибай → 아저씨", () => {
    const by = (ru: string) => glossary.find((e) => e.ru.includes(ru))!;
    expect(by("аппади").avoid).toEqual(["아버님"]);
    expect(by("омани").avoid).toEqual(["어머님"]);
    expect(by("аджибай").ko).toEqual(["아저씨"]);
    expect(rules(chapter("Омани пекла хлеб.", "어머님은 빵을 구우셨다."))).toEqual(expect.arrayContaining(["glossary:variant", "style:parents"]));
  });

  it("#103: о своих родителях — 아버지 / 어머니; 아버님 в прямой речи и в вопросах банка — не флажок", () => {
    expect(rules(chapter("Отец работал.", "아버님은 일하셨다."))).toContain("style:parents");
    expect(rules(chapter("Отец работал.", "아버지는 일하셨다."))).not.toContain("style:parents");
    expect(rules(chapter("Сосед спросил: «Отец дома?»", "이웃이 \"아버님 계세요?\" 하고 물으셨다."))).not.toContain("style:parents");
    const q: KrItem = { id: "q1", kind: "question", label: "Корни", text_ru: "А каким был ваш папа?", text_ko: "아버님은 어떤 분이셨어요?" };
    expect(checkItem(q, glossary).map((f) => f.rule)).not.toContain("style:parents");
  });

  it("#103: ㄹ-глагол с -시- — ㄹ выпадает (써셨고), ㄷ-неправильные не флажок", () => {
    const f = checkItem(chapter("Мама резала морковь.", "어머니는 당근을 썰으셨고 국수를 만들으셨다."), glossary).filter((x) => x.rule === "style:rieul");
    expect(f.map((x) => x.ko)).toEqual(["썰으셨", "만들으셨"]);
    expect(f[0]!.issue).toContain("써셨");
    expect(f[1]!.issue).toContain("만드셨");
    expect(rules(chapter("Мама резала морковь.", "어머니는 당근을 써셨고 국수를 만드셨다."))).not.toContain("style:rieul");
    // 듣다 → 들으셨다, 묻다 → 물으셨다, 걷다 → 걸으셨다 — норма
    expect(rules(chapter("Отец слушал, спрашивал, шёл.", "아버지는 들으셨고 물으셨고 걸으셨다."))).not.toContain("style:rieul");
  });

  it("#103: смешение стилей — по абзацам; разные абзацы в разных стилях — не флажок", () => {
    const f = checkItem(chapter("Жили. Послушайте. Работали.", "우리는 살았다. 여러분, 들어 봐요. 열심히 일했다."), glossary);
    expect(f.filter((x) => x.rule === "style:mixed")).toHaveLength(1);
    expect(f.find((x) => x.rule === "style:mixed")!.issue).toContain("абзаце 1");
    expect(rules(chapter("Жили.\n\nВнуки, помните.", "우리는 살았다.\n\n손주들, 꼭 기억해요."))).not.toContain("style:mixed");
  });

  it("#154: к внукам — 해라체; 해요체 в обращении к внукам — флажок style:grandkids", () => {
    const f = checkItem(chapter("Жили. Внуки, слушайте.", "우리는 살았다. 손주들아, 들어 봐요."), glossary);
    expect(f.map((x) => x.rule)).toContain("style:grandkids");
    expect(f.map((x) => x.rule)).not.toContain("style:mixed");
    expect(rules(chapter("Внуки, помните.", "손주들, 꼭 기억해요."))).toContain("style:grandkids");
    // 해라체 в том же абзаце, что 한다체, — норма
    const ok = rules(chapter("Мы жили в Уштобе. Внуки, слушайте и не забывайте.", "우리는 우슈토베에서 살았다. 손주들아, 잘 들어라. 우리 뿌리를 잊지 마라."));
    expect(ok).not.toContain("style:grandkids");
    expect(ok).not.toContain("style:mixed");
  });

  it("#183: grandkidsHaeyo — абзацы с 해요체 к внукам (для repair-chapters)", () => {
    expect(grandkidsHaeyo("우리는 살았다.\n\n손주들아, 꼭 기억해요.")).toEqual([{ paragraph: 2, ko: "손주들아, 꼭 기억해요." }]);
    expect(grandkidsHaeyo("얘들아, 들어 봐요. 잊지 마요.")).toHaveLength(1);
    expect(grandkidsHaeyo("우리는 살았다. 손주들아, 잘 들어라. 우리 뿌리를 잊지 마라.")).toEqual([]);
    // 해요체 без внуков и внуки в прямой речи — не наш случай
    expect(grandkidsHaeyo("여러분, 들어 봐요.")).toEqual([]);
    expect(grandkidsHaeyo("할머니는 \"손주야, 밥 먹어요\"라고 하셨다.")).toEqual([]);
    expect(grandkidsHaeyo(null)).toEqual([]);
  });

  it("вопросы: 해요체 и почтительное -시-", () => {
    const q = (ko: string): KrItem => ({ id: "q", kind: "question", label: "Вопросы", text_ru: "Вопрос?", text_ko: ko });
    expect(rules(q("어디에서 태어나셨어요?"))).toEqual([]);
    expect(rules(q("어디에서 태어났어?"))).toEqual(["style:haeyo", "style:honorific"]);
    expect(rules(q("가장 자랑스러운 것은 무엇이에요?"))).toContain("style:natural");
  });
});

describe("демо-книга и банк вопросов (регрессия)", () => {
  it("демо-главы проходят правила без флажков", () => {
    const flags = DEMO_STORIES.flatMap((s, i) =>
      checkItem({ id: `demo-${i + 1}`, kind: "chapter", label: s.title ?? "", text_ru: s.text_ru!, text_ko: s.text_ko!, quote_ko: s.quote_ko ?? undefined }, glossary),
    );
    expect(flags).toEqual([]);
  });

  it("каждый вопрос банка — 해요체 с -시-", () => {
    const flags = QUESTIONS.flatMap((q) => checkItem({ id: q.id, kind: "question", label: q.id, text_ru: q.ru, text_ko: q.ko }, glossary));
    expect(flags).toEqual([]);
  });
});

describe("обратный перевод и итог", () => {
  it("провайдер: OpenAI, если есть ключ (перевод на Gemini), иначе Gemini Flash, иначе mock", () => {
    expect(chooseBackMode({ OPENAI_API_KEY: "k", GEMINI_API_KEY: "g" })).toBe("openai");
    expect(chooseBackMode({ GEMINI_API_KEY: "g" })).toBe("gemini");
    expect(chooseBackMode({})).toBe("mock");
    expect(chooseBackMode({ OPENAI_API_KEY: "k", KR_CHECK_PROVIDER: "gemini" })).toBe("gemini");
  });

  it("mock: один вызов, флажок ИИ при отсутствии хангыля", async () => {
    const ai = createRouter({ store: new MemoryStore(), mode: () => "mock" });
    const r = await backTranslate(ai, [chapter("Текст", "텍스트"), { ...chapter("Текст", "text"), id: "c2" }]);
    expect(r.provider).toBe("mock");
    expect(r.meaning).toEqual({ c1: 5, c2: 1 });
    expect(r.flags.map((f) => [f.id, f.source, f.severity])).toEqual([["c2", "ai", "major"]]);
  });

  it("человеку — 1–2 главы с самыми весомыми флажками, без дублей; отчёт с маркером", () => {
    const items = [chapter("a", "가"), { ...chapter("b", "나"), id: "c2", label: "Глава 2" }, { ...chapter("c", "다"), id: "c3", label: "Глава 3" }];
    const f = (id: string, severity: "minor" | "major", ko: string) => ({ id, source: "rule" as const, rule: "x", ko, issue: "i", severity });
    const flags = [f("c1", "minor", "가가"), f("c2", "major", "나나"), f("c2", "major", "나나"), f("c3", "minor", "다다"), f("c3", "minor", "라라")];
    const picked = pickForHuman(items, flags);
    expect(picked.map((p) => p.item.id)).toEqual(["c2", "c3"]);
    expect(picked[0]!.flags).toHaveLength(1);
    const md = renderKrReport(
      { date: "2026-11-22", mode: "mock", provider: "mock", model: "mock", items, flags, meaning: {}, glossary: { total: 1, confirmed: 0 } },
      { marker: true },
    );
    expect(md.startsWith("<!-- kniga-kr -->")).toBe(true);
    expect(md).toContain("не показательно");
    expect(md).toContain("**Глава 2**");
  });
});

describe("#121: одно имя — одно написание (словарь семьи)", () => {
  const names = [
    { ru: "Лена", ko: "레나" },
    { ru: "Анна Петровна", ko: "안나 페트로브나" },
    { ru: "Уштобе", ko: "우슈토베" },
  ];
  it("имя есть в тексте (в любом падеже), а словарного написания в корейском нет — флажок", () => {
    const f = nameSpellingFlags(chapter("Мы с Леной жили в Уштобе.", "나는 렌나와 우슈토베에서 살았다."), names);
    expect(f.map((x) => [x.rule, x.ru])).toEqual([["name:spelling", "Лена"]]);
    expect(f[0]!.issue).toContain("레나");
  });
  it("написание как в словаре, имени нет в тексте, многословное имя целиком — без флажков", () => {
    expect(nameSpellingFlags(chapter("Мы с Леной жили в Уштобе.", "나는 레나와 우슈토베에서 살았다."), names)).toEqual([]);
    expect(nameSpellingFlags(chapter("Мы жили в Караганде.", "우리는 카라간다에서 살았다."), names)).toEqual([]);
    expect(nameSpellingFlags(chapter("Учила Анна Петровна.", "안나 페트로브나 선생님이 가르치셨다."), names)).toEqual([]);
    expect(nameSpellingFlags(chapter("Учила Анна Петровна.", "안나 선생님이 가르치셨다."), names).map((x) => x.ru)).toEqual(["Анна Петровна"]);
  });
  it("демо-главы: словарь демо-семьи и тексты глав сходятся", () => {
    const demo = DEMO_ENTITIES.filter((e) => e.kind !== "word").map((e) => ({ ru: e.name_ru, ko: e.name_ko }));
    const flags = DEMO_STORIES.flatMap((s, i) => nameSpellingFlags(chapter(s.text_ru ?? "", s.text_ko ?? "", { id: `demo-${i + 1}` }), demo));
    expect(flags).toEqual([]);
  });
});


describe("#198: судья KR и глоссарий корё мар, ㅂ-неправильные формы", () => {
  it("замена корё мар ровно на эквивалент глоссария — не флажок; 아버님, транслитерация и другие флажки — остаются", () => {
    const sub = "слово корё мар заменено на стандартный корейский";
    expect(glossaryEquivalent({ ko: "아버지는", ru: "аппади", issue: sub }, glossary)?.ru).toContain("аппади");
    expect(glossaryEquivalent({ ko: "어머니가", ru: "омани", issue: sub }, glossary)).toBeDefined();
    expect(glossaryEquivalent({ ko: "국수", ru: "", issue: "«кукси» передано стандартным 국수" }, glossary)).toBeDefined();
    expect(glossaryEquivalent({ ko: "김치를", ru: "чимчи", issue: sub }, glossary)).toBeDefined();
    // вариант из «не:» — ошибка, флажок остаётся
    expect(glossaryEquivalent({ ko: "아버님이", ru: "аппади", issue: sub }, glossary)).toBeUndefined();
    // транслитерация — не эквивалент
    expect(glossaryEquivalent({ ko: "아파디", ru: "аппади", issue: sub }, glossary)).toBeUndefined();
    // флажок не о замене слова
    expect(glossaryEquivalent({ ko: "국수를 1941년", ru: "кукси в 1940", issue: "год искажён" }, glossary)).toBeUndefined();
    const { kept, dropped } = withoutGlossaryNoise(
      [
        { ko: "아버지", ru: "аппади", back_ru: "отец", issue: sub },
        { ko: "1941년", ru: "1940", back_ru: "1941", issue: "год искажён" },
      ],
      glossary,
    );
    expect(dropped).toHaveLength(1);
    expect(kept.map((f) => f.ko)).toEqual(["1941년"]);
    expect(withoutGlossaryNoise(kept, undefined).kept).toHaveLength(1);
  });

  it("backTranslate снимает такие флажки и считает их; смысл ≤ 3 без major — всё ещё флажок", async () => {
    const ai = {
      async runWithMeta() {
        return {
          output: {
            chapters: [
              {
                id: "c1",
                back_ru: "Отец любил лапшу.",
                meaning: 5,
                flags: [
                  { ko: "아버지", back_ru: "отец", ru: "аппади", issue: "слово корё мар заменено на стандартный корейский", severity: "minor" as const },
                  { ko: "국수", back_ru: "лапша", ru: "кукси", issue: "корё мар заменено", severity: "minor" as const },
                ],
              },
            ],
          },
          provider: "openai",
          model: "x",
          cached: false,
        };
      },
    } as unknown as Parameters<typeof backTranslate>[0];
    const items = [chapter("Аппади любил кукси.", "아버지는 국수를 좋아하셨다.")];
    const r = await backTranslate(ai, items, glossary);
    expect(r.flags).toHaveLength(0);
    expect(r.glossaryOk).toBe(2);
    const raw = await backTranslate(ai, items);
    expect(raw.flags).toHaveLength(2);
  });

  it("ㅂ-неправильные: 참 고와게 → 곱게, 더와서 → 더워서, 고마와요 → 고마워요; верные формы — без флажка", () => {
    const issues = bieupFlags(chapter("", "할머니는 참 고와게 웃으셨다. 날이 더와서 힘들었다. 정말 고마와요.")).map((f) => f.issue);
    expect(issues).toHaveLength(3);
    expect(issues.join()).toMatch(/고와게 → 곱게/);
    expect(issues.join()).toMatch(/더와서 → 더워서/);
    expect(issues.join()).toMatch(/고마와요 → 고마워요/);
    expect(bieupFlags(chapter("", "할머니는 참 곱게 웃으셨다. 고와서 고와졌다. 더워서 도와주셨다. 고마워요. 재미와 웃음."))).toHaveLength(0);
    expect(checkItem(chapter("Она улыбалась красиво.", "할머니는 참 고와게 웃으셨다."), glossary).map((f) => f.rule)).toContain("style:bieup");
  });

  it("демо, киоск и банк не дают флажков style:bieup", () => {
    for (const s of DEMO_STORIES) expect(bieupFlags(chapter(s.text_ru ?? "", s.text_ko ?? "")), s.title ?? "").toHaveLength(0);
    expect(bieupFlags({ ...chapter("", QUESTIONS.map((q) => q.ko).join("\n")), kind: "question" })).toHaveLength(0);
  });
});

describe("#193: главы живых семей — не в kr-check / eval", () => {
  it("scripts/kr-check.ts не ходит в базу и не читает главы семей", () => {
    const src = readFileSync("scripts/kr-check.ts", "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/@\/lib\/db|getDb|SUPABASE|from\("stories"\)|story_texts/);
  });
  it("отчёт kr-check отправляет проверку семей в repair-chapters (dry run)", () => {
    const md = renderKrReport({ date: "2026-11-28", mode: "mock", provider: "mock", model: "mock", items: [], flags: [], meaning: {}, glossary: { total: 0, confirmed: 0 } });
    expect(md).toContain(FAMILIES_NOTE);
    expect(FAMILIES_NOTE).toMatch(/repair-chapters/);
    expect(FAMILIES_NOTE).toMatch(/grandkids/);
    expect(FAMILIES_NOTE).toMatch(/kk-script/);
  });
});
