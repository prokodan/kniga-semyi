import "server-only";
// Публичный вход конвейера истории (I2) для API-ручек:
//   import { pipeline } from "@/lib/pipeline";
//   await pipeline.runStep(storyId, { token });           // один шаг на HTTP-вызов
//   await pipeline.rebuild(storyId, "edit", { token });    // пересобрать после новых уточнений
//   await pipeline.view(storyId, { token });               // статус и результат
// ИИ — только через роутер (@/lib/ai). Без Supabase — память процесса, общая с интервью-агентом.
import { ai } from "@/lib/ai";
import { BUCKETS, getDbOrNull } from "@/lib/db";
import { flag } from "@/lib/flags";
import { MemoryInterviewRepo } from "@/lib/interview/repo";
import { loadTree } from "@/lib/tree";
import { createPipeline, type Pipeline } from "./engine";
import { MemoryPipelineRepo, SupabasePipelineRepo, type PipelineRepo } from "./repo";

const g = globalThis as { __interviewMemoryRepo?: MemoryInterviewRepo; __pipelineMemoryRepo?: MemoryPipelineRepo };
let instance: Pipeline | null = null;

function getRepo(): PipelineRepo {
  const db = getDbOrNull();
  // #231: перевод на казахский — только семьям с флагом lang_kk; #233: банк и подсказки по пакетам — с culture_packs
  if (db) {
    return new SupabasePipelineRepo(
      db,
      BUCKETS.audio,
      (f) => flag("lang_kk", { familyId: f.id, labs: f.labs }),
      (f) => flag("culture_packs", { familyId: f.id, labs: f.labs }),
      // #265: древо дописывается в шаге словаря — только семьям с флагом family_tree
      async (f) => {
        if (flag("family_tree", { familyId: f.id, labs: f.labs })) await loadTree(f.id, { write: true });
      },
    );
  }
  g.__interviewMemoryRepo ??= new MemoryInterviewRepo();
  g.__pipelineMemoryRepo ??= new MemoryPipelineRepo(g.__interviewMemoryRepo.stories);
  g.__pipelineMemoryRepo.sessions = g.__interviewMemoryRepo.sessions as never;
  return g.__pipelineMemoryRepo;
}

function get(): Pipeline {
  instance ??= createPipeline({ ai, repo: getRepo() });
  return instance;
}

export const pipeline: Pipeline = {
  runStep: (id, opts) => get().runStep(id, opts),
  rebuild: (id, from, opts) => get().rebuild(id, from, opts),
  processStory: (id, opts) => get().processStory(id, opts),
  view: (id, opts) => get().view(id, opts),
};

/** Контракт из issue: processStory(storyId) — все шаги подряд, runStep(storyId, step) — один шаг. */
export const processStory = (storyId: string) => pipeline.processStory(storyId);
export const runStep = (storyId: string, step?: import("./engine").PipelineStep) => pipeline.runStep(storyId, { step });

export { PipelineError, PIPELINE_STEPS, STATUS_MESSAGE, nextStep, type PipelineStep, type StepResult, type StoryView } from "./engine";
