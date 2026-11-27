// Конвейер истории в AI_MODE=mock: полный проход, текстовый ответ без расшифровки, ответ на уточнение,
// перезапуск с середины (ИИ недоступен → очередь → продолжение), failed с причиной, пересборка с edit.
import { describe, expect, it } from "vitest";
import { createRouter } from "@/lib/ai/router";
import { MemoryStore } from "@/lib/ai/store";
import { AiUnavailableError, type AiInput, type AiOutput, type AiStep } from "@/lib/ai/types";
import { createInterview } from "@/lib/interview/engine";
import { MemoryInterviewRepo } from "@/lib/interview/repo";
import type { Story } from "@/lib/types";
import editFixture from "@/fixtures/ai/edit.json";
import transcribeFixture from "@/fixtures/ai/transcribe.json";
import translateFixture from "@/fixtures/ai/translate.json";
import { createPipeline, nextStep, PipelineError } from "./engine";
import { audioMime, MemoryPipelineRepo } from "./repo";

type Override = { [S in AiStep]?: (input: AiInput<S>) => AiOutput<S> | Promise<AiOutput<S>> };

function story(over: Partial<Story> = {}): Story {
  const now = new Date().toISOString();
  return {
    id: "story-1",
    family_id: "fam-1",
    storyteller_id: "st-1",
    session_id: null,
    parent_story_id: null,
    question_id: "childhood-01",
    block: "childhood",
    audio_url: "fam-1/story-1.webm",
    duration_sec: 300,
    transcript: null,
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
    created_at: now,
    updated_at: now,
    ...over,
  };
}

function setup(opts: { override?: Override } = {}) {
  const store = new MemoryStore();
  const router = createRouter({ store, mode: () => "mock" });
  const calls: { step: AiStep; input: unknown }[] = [];
  const ai = {
    async run<S extends AiStep>(step: S, input: AiInput<S>, o?: Parameters<typeof router.run>[2]): Promise<AiOutput<S>> {
      calls.push({ step, input });
      const fn = opts.override?.[step] as ((i: AiInput<S>) => AiOutput<S>) | undefined;
      return fn ? fn(input) : router.run(step, input, o);
    },
  };
  const repo = new MemoryPipelineRepo();
  repo.tokens.set("fam-1", "tok-1");
  repo.names.set("st-1", "Ким Ен Хо");
  repo.audio.set("fam-1/story-1.webm", { data: Buffer.from("fake-audio-bytes"), mimeType: "audio/webm;codecs=opus" });
  const pipeline = createPipeline({ ai, repo });
  const count = (step: AiStep) => calls.filter((c) => c.step === step).length;
  return { pipeline, repo, store, calls, count };
}

describe("конвейер истории", () => {
  it("полный проход в mock: uploaded → transcribing → editing → translating → ready, по шагу на вызов", async () => {
    const { pipeline, repo, store, calls } = setup();
    repo.add(story());

    const r1 = await pipeline.runStep("story-1", { token: "tok-1" });
    expect(r1).toMatchObject({ ran: "transcribe", status: "editing", next: "edit", done: false, queued: false });
    const r2 = await pipeline.runStep("story-1", { token: "tok-1" });
    expect(r2).toMatchObject({ ran: "edit", status: "translating", next: "translate" });
    const r3 = await pipeline.runStep("story-1", { token: "tok-1" });
    expect(r3).toMatchObject({ ran: "translate", status: "ready", next: null, done: true, message: "Глава готова" });

    const s = (await repo.getStory("story-1"))!;
    expect(s.transcript).toBe(transcribeFixture.text);
    expect(s).toMatchObject({
      text_ru: editFixture.text_ru,
      title: editFixture.title,
      quote: editFixture.quote,
      text_ko: translateFixture.text_ko,
      title_ko: translateFixture.title_ko,
      quote_ko: translateFixture.quote_ko,
      error: null,
    });
    expect(s.facts.length).toBeGreaterThan(0);
    // MIME без параметров, вопрос из банка и имя рассказчика уходят в ИИ
    expect(calls[0]!.input).toMatchObject({ mimeType: "audio/webm", durationSec: 300, languageHint: "ru" });
    expect(calls[1]!.input).toMatchObject({ storytellerName: "Ким Ен Хо", block: "childhood" });
    // расход пишется с story_id
    expect(store.usage.map((u) => [u.step, u.story_id])).toEqual([
      ["transcribe", "story-1"],
      ["edit", "story-1"],
      ["translate", "story-1"],
    ]);

    // готовую историю повторный вызов не пересчитывает
    const again = await pipeline.runStep("story-1", { token: "tok-1" });
    expect(again).toMatchObject({ ran: null, done: true });
    expect(calls).toHaveLength(3);
  });

  it("processStory прогоняет все шаги подряд", async () => {
    const { pipeline, repo, count } = setup();
    repo.add(story());
    const r = await pipeline.processStory("story-1");
    expect(r).toMatchObject({ status: "ready", done: true });
    expect([count("transcribe"), count("edit"), count("translate")]).toEqual([1, 1, 1]);
  });

  it("текстовый ответ (transcript уже есть) пропускает расшифровку", async () => {
    const { pipeline, repo, count } = setup();
    repo.add(story({ audio_url: null, duration_sec: null, transcript: "Жили мы в Уштобе, у арыка." }));
    const r = await pipeline.runStep("story-1", { token: "tok-1" });
    expect(r).toMatchObject({ ran: "edit", status: "translating" });
    expect(count("transcribe")).toBe(0);
  });

  it("в редактуру уходят основной ответ и ответы на уточнения, без текстов уточнений", async () => {
    const { pipeline, repo, calls } = setup();
    repo.add(
      story({
        transcript: "Жили мы в Уштобе.",
        followups: [{ question: "А сколько вам было лет?", answer: "Лет шесть, наверное." }],
      }),
    );
    await pipeline.runStep("story-1");
    const input = calls[0]!.input as { transcript: string };
    expect(input.transcript).toBe("Жили мы в Уштобе.\n\nЛет шесть, наверное.");
    expect(input.transcript).not.toContain("сколько вам было");
  });

  it("голосовой ответ на уточнение только расшифровывается и сразу ready — главой не становится", async () => {
    const { pipeline, repo, count } = setup();
    repo.add(story({ id: "story-2", parent_story_id: "story-1", audio_url: "fam-1/story-1.webm" }));
    const r = await pipeline.processStory("story-2", { token: "tok-1" });
    expect(r).toMatchObject({ ran: "transcribe", status: "ready", done: true, next: null });
    expect(count("edit")).toBe(0);
    expect(count("translate")).toBe(0);
    const s = (await repo.getStory("story-2"))!;
    expect(s.transcript).toBeTruthy();
    expect(s.text_ru).toBeNull();
    await expect(pipeline.rebuild("story-2", "edit")).rejects.toBeInstanceOf(PipelineError);
  });

  it("ИИ недоступен → статус остаётся на шаге, queued + retryInMinutes; повтор продолжает с середины", async () => {
    let down = true;
    const { pipeline, repo, count } = setup({
      override: {
        translate: () => {
          if (down) throw new AiUnavailableError("translate", [{ provider: "gemini", model: "m", reason: "429" }]);
          return translateFixture;
        },
      },
    });
    repo.add(story());
    const queued = await pipeline.processStory("story-1", { token: "tok-1" });
    expect(queued).toMatchObject({ queued: true, status: "translating", next: "translate", retryInMinutes: 10 });
    expect(queued.message).toContain("через 10 минут");
    const mid = (await repo.getStory("story-1"))!;
    expect(mid).toMatchObject({ status: "translating", error: null, text_ru: editFixture.text_ru });

    down = false;
    const done = await pipeline.runStep("story-1", { token: "tok-1" });
    expect(done).toMatchObject({ ran: "translate", status: "ready", done: true });
    // уже сохранённые шаги не пересчитывались
    expect([count("transcribe"), count("edit"), count("translate")]).toEqual([1, 1, 2]);
  });

  it("сбой не ИИ → failed с понятной причиной; после исправления перезапуск идёт с того же шага", async () => {
    const { pipeline, repo, count } = setup();
    repo.add(story({ audio_url: "fam-1/missing.webm" }));
    const r = await pipeline.runStep("story-1", { token: "tok-1" });
    expect(r).toMatchObject({ status: "failed", next: null, done: false });
    expect(r.error).toMatch(/^Шаг «расшифровка»: Не удалось открыть запись/);
    expect((await repo.getStory("story-1"))!.error).toBe(r.error);

    repo.audio.set("fam-1/missing.webm", { data: Buffer.from("x") });
    const retry = await pipeline.processStory("story-1", { token: "tok-1" });
    expect(retry).toMatchObject({ status: "ready", error: null });
    expect(count("transcribe")).toBe(1);
  });

  it("нет ни записи, ни текста → failed", async () => {
    const { pipeline, repo } = setup();
    repo.add(story({ audio_url: null }));
    const r = await pipeline.runStep("story-1");
    expect(r.status).toBe("failed");
    expect(r.error).toContain("Нет ни записи, ни текста");
  });

  it("запись длиннее 10 минут → failed без вызова ИИ", async () => {
    const { pipeline, repo, count } = setup();
    repo.add(story({ duration_sec: 900 }));
    const r = await pipeline.runStep("story-1");
    expect(r.error).toContain("длиннее 10 минут");
    expect(count("transcribe")).toBe(0);
  });

  it("неверный ответ модели внутри шага (не ИИ-недоступность) → failed", async () => {
    const { pipeline, repo } = setup({ override: { transcribe: () => ({ text: "   ", language: "ru" }) } });
    repo.add(story());
    const r = await pipeline.runStep("story-1");
    expect(r).toMatchObject({ status: "failed" });
    expect(r.error).toContain("не удалось разобрать речь");
  });

  it("rebuild from edit очищает главу и перевод и собирает заново с новыми уточнениями", async () => {
    const { pipeline, repo, count, calls } = setup();
    repo.add(story());
    await pipeline.processStory("story-1");
    repo.stories.get("story-1")!.followups = [{ question: "Где?", answer: "В Уштобе, у арыка." }];

    const r = await pipeline.rebuild("story-1", "edit", { token: "tok-1" });
    expect(r).toMatchObject({ ran: "edit", status: "translating" });
    expect((await repo.getStory("story-1"))!.text_ko).toBeNull();
    await pipeline.processStory("story-1");
    expect([count("transcribe"), count("edit"), count("translate")]).toEqual([1, 2, 2]);
    expect((calls.filter((c) => c.step === "edit").at(-1)!.input as { transcript: string }).transcript).toContain("у арыка");
  });

  it("#230: глава пишется и в story_texts (ru, ko) зеркалом колонок; перевод — ru → ko без пары во входе", async () => {
    const { pipeline, repo, calls } = setup();
    repo.add(story());
    await pipeline.processStory("story-1");
    const s = repo.stories.get("story-1")!;
    expect(repo.texts.get("story-1")).toEqual([
      { story_id: "story-1", lang: "ru", title: s.title, text: s.text_ru, quote: s.quote },
      { story_id: "story-1", lang: "ko", title: s.title_ko, text: s.text_ko, quote: s.quote_ko },
    ]);
    const tl = calls.find((c) => c.step === "translate")!.input as Record<string, unknown>;
    expect(tl).not.toHaveProperty("from");
    expect(tl).not.toHaveProperty("to");

    // сброс шага (rebuild с edit) убирает строки — чтение снова по колонкам
    await pipeline.rebuild("story-1", "edit", { token: "tok-1" });
    expect(repo.texts.get("story-1")!.map((r) => r.lang)).toEqual(["ru"]);
  });

  it("#230: чтение главы — из story_texts, если строка есть", async () => {
    const { repo } = setup();
    repo.add(story({ text_ru: "Колонка", title: "Т", quote: "Ц", status: "ready" }));
    repo.texts.set("story-1", [{ story_id: "story-1", lang: "ru", title: "Т2", text: "Вычитанный текст", quote: "Ц2" }]);
    expect(await repo.getStory("story-1")).toMatchObject({ text_ru: "Вычитанный текст", title: "Т2", quote: "Ц2", text_ko: null });
  });

  it("явный шаг: уже выполненный или не по порядку → bad_request", async () => {
    const { pipeline, repo } = setup();
    repo.add(story({ transcript: "текст" }));
    await expect(pipeline.runStep("story-1", { step: "transcribe" })).rejects.toMatchObject({ code: "bad_request" });
    await expect(pipeline.runStep("story-1", { step: "translate" })).rejects.toMatchObject({ code: "bad_request" });
    await expect(pipeline.runStep("story-1", { step: "edit" })).resolves.toMatchObject({ ran: "edit" });
  });

  it("чужой токен → forbidden, нет истории → not_found", async () => {
    const { pipeline, repo } = setup();
    repo.add(story());
    await expect(pipeline.runStep("story-1", { token: "чужой" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(pipeline.view("nope", { token: "tok-1" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("view отдаёт статус, сообщение и результат", async () => {
    const { pipeline, repo } = setup();
    repo.add(story());
    await pipeline.runStep("story-1");
    const v = await pipeline.view("story-1", { token: "tok-1" });
    expect(v).toMatchObject({ status: "editing", next: "edit", done: false, message: "Бережно собираем главу…", isFollowup: false });
  });
});

describe("nextStep и MIME", () => {
  it("следующий шаг — по данным", () => {
    expect(nextStep({ transcript: null, text_ru: null, text_ko: null, parent_story_id: null })).toBe("transcribe");
    expect(nextStep({ transcript: "a", text_ru: null, text_ko: null, parent_story_id: null })).toBe("edit");
    expect(nextStep({ transcript: "a", text_ru: "b", text_ko: null, parent_story_id: null })).toBe("translate");
    expect(nextStep({ transcript: "a", text_ru: "b", text_ko: "c", parent_story_id: null })).toBeNull();
    expect(nextStep({ transcript: "a", text_ru: null, text_ko: null, parent_story_id: "p" })).toBeNull();
  });
  it("audioMime", () => {
    expect(audioMime("audio/webm;codecs=opus", "x")).toBe("audio/webm");
    expect(audioMime("", "a/b.m4a")).toBe("audio/mp4");
    expect(audioMime("application/octet-stream", "a/b.mp3")).toBe("audio/mpeg");
    expect(audioMime("video/mp4", "a")).toBe("audio/mp4");
  });
});

describe("интервью + конвейер (договорённость I10)", () => {
  it("голосовой ответ на уточнение помечается parent_story_id и уходит в followups основной истории", async () => {
    const router = createRouter({ store: new MemoryStore(), mode: () => "mock" });
    const irepo = new MemoryInterviewRepo();
    irepo.addFamily("fam-1", "tok-1", ["st-1"]);
    const interview = createInterview({ ai: router, repo: irepo });
    const prepo = new MemoryPipelineRepo(irepo.stories);
    prepo.audio.set("a.webm", { data: Buffer.from("x") });
    const pipeline = createPipeline({ ai: router, repo: prepo });

    const { sessionId } = await interview.startSession({ familyId: "fam-1", storytellerId: "st-1", mode: "family", token: "tok-1" });
    const first = await interview.submitAnswer(sessionId, { text: "Да, было." }, { token: "tok-1" }); // короткий → уточнение
    expect(first.type).toBe("followup");
    const mainId = first.storyId!;

    // I1 создаёт запись ответа на уточнение, конвейер её расшифровывает
    const voice = await irepo.createStory({
      family_id: "fam-1",
      storyteller_id: "st-1",
      session_id: sessionId,
      question_id: null,
      block: null,
      transcript: null,
    });
    irepo.stories.get(voice.id)!.audio_url = "a.webm";
    await pipeline.runStep(voice.id, { token: "tok-1" });
    await interview.submitAnswer(sessionId, { storyId: voice.id }, { token: "tok-1" });

    const followupStory = (await irepo.getStory(voice.id))!;
    expect(followupStory.parent_story_id).toBe(mainId);
    expect(followupStory.status).toBe("editing"); // шаг edit ещё не вызывали
    const r = await pipeline.runStep(voice.id, { token: "tok-1" });
    expect(r).toMatchObject({ ran: null, status: "ready" }); // edit не делается — только отметка ready
    expect((await irepo.getStory(voice.id))!.text_ru).toBeNull();
    expect((await irepo.getStory(mainId))!.followups).toHaveLength(1);

    // основная история (текстовый ответ) собирается в главу без расшифровки
    const main = await pipeline.processStory(mainId, { token: "tok-1" });
    expect(main).toMatchObject({ status: "ready", done: true });
  });
});
