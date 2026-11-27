// #298: перевод ru → kk в конвейере с защитами как у ko — словарь семьи (name_kk), правка черновика → перевод заново.
// Конвейер в AI_MODE=mock, хранилище в памяти (как langs.test.ts).
import { describe, expect, it } from "vitest";
import { createRouter } from "@/lib/ai/router";
import { MemoryStore } from "@/lib/ai/store";
import type { AiInput, AiStep } from "@/lib/ai/types";
import type { Story } from "@/lib/types";
import translateFixture from "@/fixtures/ai/translate.json";
import translateKk from "@/fixtures/ai/translate.kk.json";
import { createPipeline } from "./engine";
import { MemoryPipelineRepo } from "./repo";

function story(id: string, minutes: number, transcript: string): Story {
  const at = new Date(Date.UTC(2026, 10, 28, 10, minutes)).toISOString();
  return {
    id,
    family_id: "fam-kk",
    storyteller_id: "st-1",
    session_id: null,
    parent_story_id: null,
    question_id: `q-${id}`,
    block: "childhood",
    audio_url: null,
    duration_sec: null,
    transcript,
    text_ru: null,
    text_ko: null,
    title: null,
    title_ko: null,
    quote: null,
    quote_ko: null,
    facts: [],
    followups: [],
    status: "uploaded",
    error: null,
    sort_order: null,
    created_at: at,
    updated_at: at,
  };
}

function setup(langs: ("ru" | "ko" | "kk")[]) {
  const router = createRouter({ store: new MemoryStore(), mode: () => "mock" });
  const calls: { step: AiStep; input: AiInput<AiStep> }[] = [];
  const ai = {
    run: (async (step: AiStep, input: AiInput<AiStep>, o?: Parameters<typeof router.run>[2]) => {
      calls.push({ step, input });
      return router.run(step, input as never, o);
    }) as typeof router.run,
  };
  const repo = new MemoryPipelineRepo();
  repo.bookLangs.set("fam-kk", langs);
  repo.add(story("s-1", 0, "Я родился в 1940 году в Уштобе. Отец работал в колхозе."));
  repo.add(story("s-2", 5, "Зимой мама варила кукси, а летом мы ловили рыбу в арыке."));
  const translates = () => calls.filter((c) => c.step === "translate").map((c) => c.input as AiInput<"translate">);
  return { pipeline: createPipeline({ ai, repo }), repo, translates };
}

const kkRow = (repo: MemoryPipelineRepo, id: string) => repo.texts.get(id)?.find((r) => r.lang === "kk");

describe("перевод ru → kk как у ko (#298)", () => {
  it("первая глава запоминает казахское написание места (name_kk), следующая получает его во входе names", async () => {
    const { pipeline, repo, translates } = setup(["ru", "kk"]);
    await pipeline.processStory("s-1");
    const place = repo.entities.find((e) => e.name_ru === "Уштобе") as { name_kk?: string | null } | undefined;
    expect(place?.name_kk).toBe("Үштөбе");
    expect(translates()[0]).not.toHaveProperty("names"); // словарь пуст — вход как до #298
    await pipeline.processStory("s-2");
    expect(translates()[1]).toMatchObject({ to: "kk", names: [{ ru: "Уштобе", ko: "Үштөбе" }] });
    expect(kkRow(repo, "s-2")).toMatchObject({ text: translateKk.text, title: translateKk.title });
  });

  it("правка черновика (только заголовок) → казахский перевод заново с новым заголовком (п. 4)", async () => {
    const { pipeline, repo, translates } = setup(["ru", "kk"]);
    await pipeline.processStory("s-1");
    expect(kkRow(repo, "s-1")).toBeTruthy();
    // как components/draft/save.ts: новые поля + KR очищен + dropStaleTranslations (lib/pipeline/index.ts)
    await repo.updateStory("s-1", { title: "Новый заголовок", text_ko: null, title_ko: null, quote_ko: null, status: "translating", error: null });
    expect(kkRow(repo, "s-1")).toBeTruthy(); // text_ru тот же — триггер stories_stale_translations не сработал бы
    await repo.dropTranslations((await repo.getStory("s-1"))!);
    expect(kkRow(repo, "s-1")).toBeUndefined();
    const res = await pipeline.runStep("s-1", { step: "translate" });
    expect(res.status).toBe("ready");
    expect(translates().at(-1)).toMatchObject({ to: "kk", title: "Новый заголовок" });
    expect(kkRow(repo, "s-1")).toBeTruthy();
  });

  it("RU + KR не меняется: вход без пары и без казахского словаря, текст KR — как в фикстуре", async () => {
    const { pipeline, repo, translates } = setup(["ru", "ko"]);
    await pipeline.processStory("s-1");
    await pipeline.processStory("s-2");
    for (const t of translates()) {
      expect(t).not.toHaveProperty("to");
      expect(t).not.toHaveProperty("from");
    }
    expect((await repo.getStory("s-2"))!.text_ko).toBe(translateFixture.text_ko);
    expect(repo.entities.every((e) => !(e as { name_kk?: string | null }).name_kk)).toBe(true);
  });
});
