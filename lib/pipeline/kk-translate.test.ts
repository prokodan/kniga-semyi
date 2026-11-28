// #313: перевод ru → kk с одним повтором по замечанию (retry_note) — lib/pipeline/kk-translate.ts.
import { describe, expect, it } from "vitest";
import translateKk from "@/fixtures/ai/translate.kk.json";
import editFixture from "@/fixtures/ai/edit.json";
import { inputSchemas, translateInput, type AiInput, type AiOutput } from "@/lib/ai/types";
import { stableStringify } from "@/lib/ai/util";
import { translateKk as run, kkLogLines } from "./kk-translate";

const good: AiOutput<"translate"> = { text_ko: translateKk.text, title_ko: translateKk.title, quote_ko: translateKk.quote };
const src = { text_ru: editFixture.text_ru, title: editFixture.title, quote: editFixture.quote };

function fake(answers: (AiOutput<"translate"> | Error)[]) {
  const inputs: AiInput<"translate">[] = [];
  const fn = async (input: AiInput<"translate">) => {
    inputs.push(input);
    const a = answers[Math.min(inputs.length - 1, answers.length - 1)]!;
    if (a instanceof Error) throw a;
    return a;
  };
  return { fn, inputs };
}

describe("translateKk (#313)", () => {
  it("чистый перевод — один вызов, без retry_note (вход и ключ кэша как до #313)", async () => {
    const f = fake([good]);
    const t = await run(f.fn, src, [], []);
    expect(f.inputs).toHaveLength(1);
    expect(f.inputs[0]).not.toHaveProperty("retry_note");
    expect(t.retry).toBeNull();
    expect(t.res.out).toEqual(good);
  });

  it("остался хангыль и KGB → один повтор с замечанием; повтор чище — берём его", async () => {
    const bad = { ...good, text_ko: `${good.text_ko} 우슈토베 KGB` };
    const f = fake([bad, good]);
    const t = await run(f.fn, src, [], []);
    expect(f.inputs).toHaveLength(2);
    expect(f.inputs[1]).toMatchObject({ to: "kk", retry_note: expect.stringContaining("хангыль") });
    expect(f.inputs[1]!.retry_note).toContain("KGB");
    expect(t.retry).toMatchObject({ kept: "retry" });
    expect(t.res.out.text_ko).toBe(good.text_ko);
  });

  it("повтор не лучше — остаётся первая попытка; повтор упал — тоже первая, глава не падает", async () => {
    const bad = { ...good, text_ko: `${good.text_ko} Было холодно.` };
    const same = await run(fake([bad, bad]).fn, src, [], []);
    expect(same.retry).toMatchObject({ kept: "first" });
    expect(same.res.left.russian).toEqual(["было"]);
    const failed = await run(fake([bad, new Error("ИИ недоступен")]).fn, src, [], []);
    expect(failed.retry).toMatchObject({ kept: "first", error: "ИИ недоступен" });
    expect(failed.res.out.text_ko).toBe(bad.text_ko);
  });

  it("повторов не больше одного", async () => {
    const bad = { ...good, text_ko: `${good.text_ko} 한국` };
    const f = fake([bad, bad, bad]);
    await run(f.fn, src, [], []);
    expect(f.inputs).toHaveLength(2);
  });

  it("лог — без текста главы: числа и правила", async () => {
    const bad = { ...good, text_ko: `${good.text_ko} Было холодно.` };
    const t = await run(fake([bad, bad]).fn, src, [], []);
    const l = kkLogLines("abcd1234", t);
    expect(l.info.join("\n")).toContain("повтор с замечанием");
    expect(l.warn.join("\n")).toContain("русские слова — 1");
    expect([...l.info, ...l.warn].join("\n")).not.toContain(good.text_ko.slice(0, 30));
  });
});

describe("RU + KR не меняется (#313)", () => {
  it("вход ru → ko без retry_note: после схемы ключ кэша тот же, что до #313", () => {
    const ko = translateInput("ru", "ko", src);
    const parsed = inputSchemas.translate.parse(ko);
    expect(parsed).not.toHaveProperty("retry_note");
    expect(stableStringify(parsed)).toBe(stableStringify({ text_ru: src.text_ru, title: src.title, quote: src.quote }));
  });
});
