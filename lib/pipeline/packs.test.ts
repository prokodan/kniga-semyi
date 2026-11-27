// #233 (флаг culture_packs): edit получает текст вопроса из банка семьи (её культурные пакеты), а не из банка V0.
import { describe, expect, it } from "vitest";
import { createRouter } from "@/lib/ai/router";
import { MemoryStore } from "@/lib/ai/store";
import type { AiInput, AiStep } from "@/lib/ai/types";
import type { Story } from "@/lib/types";
import { createPipeline } from "./engine";
import { MemoryPipelineRepo } from "./repo";

function story(questionId: string, block: Story["block"]): Story {
  const now = new Date().toISOString();
  return {
    id: "s-1",
    family_id: "fam-1",
    storyteller_id: "st-1",
    session_id: null,
    parent_story_id: null,
    question_id: questionId,
    block,
    audio_url: null,
    duration_sec: null,
    transcript: "На Наурыз мама варила наурыз коже, к нам приходили все соседи, а мы, дети, ходили по домам и поздравляли старших.",
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
  };
}

async function editInput(questionId: string, block: Story["block"], packs: string[] | null) {
  const router = createRouter({ store: new MemoryStore(), mode: () => "mock" });
  const calls: { step: AiStep; input: AiInput<AiStep> }[] = [];
  const ai = {
    run: (async (step: AiStep, input: AiInput<AiStep>, o?: Parameters<typeof router.run>[2]) => {
      calls.push({ step, input });
      return router.run(step, input as never, o);
    }) as typeof router.run,
  };
  const repo = new MemoryPipelineRepo();
  repo.packs.set("fam-1", packs);
  repo.add(story(questionId, block));
  await createPipeline({ ai, repo }).processStory("s-1");
  return calls.find((c) => c.step === "edit")!.input as AiInput<"edit">;
}

describe("конвейер: текст вопроса по пакетам семьи (#233)", () => {
  it("без пакетов — банк V0 (корё-сарам), как сейчас", async () => {
    expect((await editInput("traditions-03", "traditions", null)).questionText).toMatch(/асянди/);
  });

  it("general + kz — переформулированный вопрос слоя и добавленный вопрос слоя", async () => {
    expect((await editInput("traditions-03", "traditions", ["general", "kz"])).questionText).toMatch(/Наурыз/);
    expect((await editInput("roots-kz-01", "roots", ["general", "kz"])).questionText).toMatch(/жеті ата/);
  });

  it("general — общий вопрос без реалий", async () => {
    expect((await editInput("traditions-03", "traditions", ["general"])).questionText).toBe("Какие праздники отмечали в вашей семье?");
  });
});
