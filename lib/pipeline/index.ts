import "server-only";
// Публичный вход конвейера истории (I2) для API-ручек:
//   import { pipeline } from "@/lib/pipeline";
//   await pipeline.runStep(storyId, { token });           // один шаг на HTTP-вызов
//   await pipeline.rebuild(storyId, "edit", { token });    // пересобрать после новых уточнений
//   await pipeline.view(storyId, { token });               // статус и результат
// ИИ — только через роутер (@/lib/ai). Без Supabase — память процесса, общая с интервью-агентом.
import { ai } from "@/lib/ai";
import { BUCKETS, getDbOrNull } from "@/lib/db";
import { MemoryInterviewRepo } from "@/lib/interview/repo";
import { createPipeline, type Pipeline } from "./engine";
import { MemoryPipelineRepo, SupabasePipelineRepo, type PipelineRepo } from "./repo";

const g = globalThis as { __interviewMemoryRepo?: MemoryInterviewRepo; __pipelineMemoryRepo?: MemoryPipelineRepo };
let instance: Pipeline | null = null;

function getRepo(): PipelineRepo {
  const db = getDbOrNull();
  if (db) return new SupabasePipelineRepo(db, BUCKETS.audio);
  g.__interviewMemoryRepo ??= new MemoryInterviewRepo();
  g.__pipelineMemoryRepo ??= new MemoryPipelineRepo(g.__interviewMemoryRepo.stories);
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
