import "server-only";
// Публичный вход интервью-агента (I10) для API-ручек:
//   import { interview } from "@/lib/interview";
//   await interview.startSession({ familyId, storytellerId, mode, token });
//   await interview.submitAnswer(sessionId, { text } | { storyId }, { token });
//   await interview.skip(sessionId, "skip" | "later", { token });
// ИИ — только через роутер (@/lib/ai). Без Supabase — память процесса (локальная разработка).
import { ai } from "@/lib/ai";
import { getDbOrNull } from "@/lib/db";
import { createInterview, type Interview } from "./engine";
import { MemoryInterviewRepo, SupabaseInterviewRepo, type InterviewRepo } from "./repo";

const g = globalThis as { __interviewMemoryRepo?: MemoryInterviewRepo };
let instance: Interview | null = null;

function getRepo(): InterviewRepo {
  const db = getDbOrNull();
  if (db) return new SupabaseInterviewRepo(db);
  g.__interviewMemoryRepo ??= new MemoryInterviewRepo(); // переживает hot-reload в dev
  return g.__interviewMemoryRepo;
}

function get(): Interview {
  instance ??= createInterview({ ai, repo: getRepo() });
  return instance;
}

export const interview: Pick<Interview, "startSession" | "submitAnswer" | "skip"> = {
  startSession: (input) => get().startSession(input),
  submitAnswer: (id, input, opts) => get().submitAnswer(id, input, opts),
  skip: (id, action, opts) => get().skip(id, action, opts),
};

export { InterviewError, type AnswerResult, type StartResult, type QuestionView } from "./engine";
export { MAX_FOLLOWUPS } from "./policy";
