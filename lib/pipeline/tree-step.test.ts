// #265: древо дописывается в шаге словаря (после edit), а не только при открытии /f/<токен>/tree.
import { describe, expect, it } from "vitest";
import { createRouter } from "@/lib/ai/router";
import { MemoryStore } from "@/lib/ai/store";
import type { AiInput, AiOutput, AiStep } from "@/lib/ai/types";
import { applyPlan, planTree, type TreeEdge, type TreeSource } from "@/lib/tree/build";
import type { Story } from "@/lib/types";
import { createPipeline } from "./engine";
import { MemoryPipelineRepo } from "./repo";

const base = {
  family_id: "fam-1",
  storyteller_id: "st-1",
  session_id: null,
  parent_story_id: null,
  question_id: null,
  block: null,
  audio_url: null,
  duration_sec: null,
  text_ru: null,
  text_ko: null,
  title: null,
  title_ko: null,
  quote: null,
  quote_ko: null,
  facts: [],
  followups: [],
  status: "uploaded" as const,
  error: null,
  sort_order: null,
  created_at: "2026-11-24T10:00:00Z",
  updated_at: "2026-11-24T10:00:00Z",
} satisfies Omit<Story, "id" | "transcript">;

function setup() {
  const router = createRouter({ store: new MemoryStore(), mode: () => "mock" });
  const ai = {
    async run<S extends AiStep>(step: S, input: AiInput<S>, o?: Parameters<typeof router.run>[2]): Promise<AiOutput<S>> {
      if (step === "edit") return { text_ru: "Мама пекла хлеб.", title: "Мама", quote: "", facts: [{ type: "person", value: "мама", relation: "мать" }] } as AiOutput<S>;
      return router.run(step, input, o);
    },
  };
  const repo = new MemoryPipelineRepo();
  return { repo, pipeline: createPipeline({ ai, repo }) };
}

describe("#265 древо в шаге словаря", () => {
  it("глава с «мама — мать» → ребро parent от мамы к рассказчику (вызывается после словаря)", async () => {
    const { repo, pipeline } = setup();
    let edges: TreeEdge[] = [];
    let entitiesAtCall = -1;
    let mom: string | undefined;
    let me: string | undefined;
    repo.updateTree = async (story) => {
      entitiesAtCall = repo.entities.length;
      const s = (await repo.getStory(story.id))!;
      const src: TreeSource = {
        familyId: story.family_id,
        storytellers: [{ id: "st-1", name: "Ким Чер Су", name_ko: null, birth_year: 1938, death_year: null, photo_url: null, created_at: "2026-11-20T10:00:00Z", entity_id: null }],
        entities: repo.entities.filter((e) => e.family_id === story.family_id),
        chapters: [{ id: s.id, storyteller_id: s.storyteller_id, facts: s.facts }],
        relations: [],
      };
      let n = 0;
      const plan = planTree(src, () => `t${++n}`);
      const all = applyPlan(src, plan);
      edges = all.relations;
      mom = all.entities.find((e) => e.name_ru === "мама")?.id;
      me = plan.links[0]?.entityId;
    };
    repo.add({ ...base, id: "s1", transcript: "Мама пекла хлеб каждое утро." });
    const r = await pipeline.processStory("s1");
    expect(r).toMatchObject({ status: "ready", done: true });
    expect(entitiesAtCall).toBeGreaterThan(0); // словарь уже записан, когда строится древо
    expect(mom && me).toBeTruthy();
    expect(edges).toContainEqual({ from_entity_id: mom, to_entity_id: me, kind: "parent", source: "auto" });
  });

  it("сбой древа не роняет главу", async () => {
    const { repo, pipeline } = setup();
    repo.updateTree = async () => {
      throw new Error("permission denied for table family_relations");
    };
    repo.add({ ...base, id: "s2", transcript: "Мама пекла хлеб каждое утро." });
    expect(await pipeline.processStory("s2")).toMatchObject({ status: "ready", done: true });
  });
});
