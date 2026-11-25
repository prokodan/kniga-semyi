// Пункт 1: главы не зависают — аренда шага (без дублей), устаревший шаг не перетирает пересборку,
// «Перезапустить сборку» продолжает с застрявшего шага, дедлайн шага уходит в роутер.
import { describe, expect, it } from "vitest";
import { createRouter } from "@/lib/ai/router";
import { MemoryStore } from "@/lib/ai/store";
import type { AiInput, AiOutput, AiStep } from "@/lib/ai/types";
import type { Story } from "@/lib/types";
import { createPipeline, STEP_BUDGET_MS, STEP_LEASE_MS } from "./engine";
import { MemoryPipelineRepo } from "./repo";

function story(over: Partial<Story> = {}): Story {
  const now = new Date().toISOString();
  return {
    id: "s1", family_id: "f1", storyteller_id: "t1", session_id: null, parent_story_id: null,
    question_id: "childhood-02", block: "childhood", audio_url: "f1/s1.webm", duration_sec: 30,
    transcript: "Мы жили в Уштобе. Отец купил мне велосипед.", text_ru: null, text_ko: null, title: null, title_ko: null,
    quote: null, quote_ko: null, facts: [], followups: [], status: "editing", error: null, sort_order: null,
    created_at: now, updated_at: now, ...over,
  };
}

// Часы теста — от настоящего времени: дедлайн шага (started + STEP_BUDGET_MS) роутер сравнивает с Date.now(),
// и с часами, застывшими на 23.11, после этой даты каждый шаг сразу «опаздывал» (AiUnavailable → статус не двигался).
function setup(clock = { t: Date.now() }, hook?: (step: AiStep, opts: unknown) => Promise<void> | void) {
  const router = createRouter({ store: new MemoryStore(), mode: () => "mock" });
  const seen: { step: AiStep; opts: unknown }[] = [];
  const ai = {
    async run<S extends AiStep>(step: S, input: AiInput<S>, opts?: Parameters<typeof router.run>[2]): Promise<AiOutput<S>> {
      seen.push({ step, opts });
      await hook?.(step, opts);
      return router.run(step, input, opts);
    },
  };
  const repo = new MemoryPipelineRepo();
  const pipeline = createPipeline({ ai, repo, now: () => clock.t });
  return { pipeline, repo, seen, clock };
}

describe("застрявшие главы", () => {
  it("аренда из базы в формате «+00:00» — своя, результат шага сохраняется", async () => {
    const { pipeline, repo } = setup();
    repo.add(story());
    const orig = repo.updateStory.bind(repo);
    repo.updateStory = async (id, patch) => {
      const p = { ...patch };
      if (typeof p.step_started_at === "string") p.step_started_at = p.step_started_at.replace("Z", "+00:00").replace(/\.\d+/, (m) => m.padEnd(7, "0"));
      return orig(id, p);
    };
    const r = await pipeline.runStep("s1");
    expect(r).toMatchObject({ ran: "edit", status: "translating" });
    expect((await repo.getStory("s1"))!.text_ru).toBeTruthy();
  });

  it("идущий шаг (аренда) второй вызов не дублирует: running, ИИ не вызывается", async () => {
    const { pipeline, repo, seen, clock } = setup();
    repo.add(story({ step_started_at: new Date(clock.t - 10_000).toISOString() }));
    const r = await pipeline.runStep("s1");
    expect(r).toMatchObject({ running: true, ran: null, next: "edit" });
    expect(seen).toHaveLength(0);
  });

  it("аренда старше 65 с (функцию убили по таймауту) — шаг выполняется снова", async () => {
    const { pipeline, repo, clock } = setup();
    repo.add(story({ step_started_at: new Date(clock.t - STEP_LEASE_MS - 1_000).toISOString() }));
    const r = await pipeline.runStep("s1");
    expect(r).toMatchObject({ ran: "edit", status: "translating", next: "translate" });
    expect((await repo.getStory("s1"))!.step_started_at).toBeNull();
  });

  it("«Перезапустить сборку» (restart) снимает аренду, обнуляет kick_attempts и продолжает с застрявшего шага", async () => {
    const { pipeline, repo, clock } = setup();
    repo.add(story({ status: "failed", error: "x", kick_attempts: 3, text_ru: "Глава", title: "Т", step_started_at: new Date(clock.t - 5_000).toISOString() }));
    const r = await pipeline.runStep("s1", { restart: true });
    expect(r).toMatchObject({ ran: "translate", status: "ready", done: true });
    const s = (await repo.getStory("s1"))!;
    expect(s).toMatchObject({ kick_attempts: 0, step_started_at: null, error: null, text_ru: "Глава" });
  });

  it("шаг получает дедлайн и отдаёт его роутеру", async () => {
    const { pipeline, repo, seen, clock } = setup();
    repo.add(story());
    await pipeline.runStep("s1");
    expect(seen[0]).toMatchObject({ step: "edit", opts: { storyId: "s1", deadline: clock.t + STEP_BUDGET_MS } });
  });

  it("пока шёл старый шаг, главу пересобрали — старый результат не перетирает новый", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let first = true;
    const { pipeline, repo, clock } = setup(undefined, async (step) => {
      if (step === "edit" && first) {
        first = false;
        await gate;
      }
    });
    repo.add(story());
    const slow = pipeline.runStep("s1"); // старый edit висит
    await new Promise((r) => setTimeout(r, 5));
    clock.t += 1_000;
    await repo.updateStory("s1", { followups: undefined } as never);
    const fresh = pipeline.rebuild("s1", "edit"); // пересборка идёт сразу, не ждёт аренды
    const rf = await fresh;
    expect(rf).toMatchObject({ ran: "edit" });
    release();
    const rs = await slow;
    expect(rs.ran).toBeNull();
    expect((await repo.getStory("s1"))!.status).toBe("translating");
  });
});
