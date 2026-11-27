import "server-only";
// Публичный вход интервью-агента (I10) для API-ручек:
//   import { interview } from "@/lib/interview";
//   await interview.startSession({ familyId, storytellerId, mode, token });
//   await interview.submitAnswer(sessionId, { text } | { storyId }, { token });
//   await interview.skip(sessionId, "skip" | "later", { token });
// ИИ — только через роутер (@/lib/ai). Без Supabase — память процесса (локальная разработка).
import { ai } from "@/lib/ai";
import { getDbOrNull } from "@/lib/db";
import { getFamilyStore, MemoryFamilyStore } from "@/lib/db/access";
import { flag } from "@/lib/flags";
import { familyPacks } from "./bank";
import { createInterview, type Interview } from "./engine";
import { MemoryInterviewRepo, SupabaseInterviewRepo, type InterviewRepo } from "./repo";

const g = globalThis as { __interviewMemoryRepo?: MemoryInterviewRepo };
let instance: Interview | null = null;

function getRepo(): InterviewRepo {
  const db = getDbOrNull();
  // #233: банк вопросов по культурным пакетам семьи — только с флагом culture_packs (labs или окружение)
  if (db) return new SupabaseInterviewRepo(db, (f) => flag("culture_packs", { familyId: f.id, labs: f.labs }));
  g.__interviewMemoryRepo ??= new MemoryInterviewRepo(); // переживает hot-reload в dev
  g.__interviewMemoryRepo.packsResolver ??= memoryPacks;
  return g.__interviewMemoryRepo;
}

/** #233, локально без Supabase: пакеты семьи из памяти (семья создана на /start в этом же процессе). */
function memoryPacks(familyId: string): string[] | null {
  const store = getFamilyStore();
  const family = store instanceof MemoryFamilyStore ? store.families.get(familyId) : undefined;
  return family ? familyPacks(family, flag("culture_packs", { familyId, labs: family.labs ?? null })) : null;
}

/** #105 п. 1–2: меньше вызовов ИИ на ответ — за флагом lang_kk (окружение или labs семьи). */
async function fewerCalls(familyId: string): Promise<boolean> {
  const db = getDbOrNull();
  if (!db) return flag("lang_kk");
  // "*": labs — колонка из миграции #223; ошибка / нет семьи — решает окружение
  const { data } = await db.from("families").select("*").eq("id", familyId).maybeSingle();
  return flag("lang_kk", { familyId, labs: (data as { labs?: string[] } | null)?.labs ?? null });
}

function get(): Interview {
  instance ??= createInterview({ ai, repo: getRepo(), fewerCalls });
  return instance;
}

export const interview: Pick<Interview, "startSession" | "submitAnswer" | "skip"> = {
  startSession: (input) => get().startSession(input),
  submitAnswer: (id, input, opts) => get().submitAnswer(id, input, opts),
  skip: (id, action, opts) => get().skip(id, action, opts),
};

export { InterviewError, type AnswerResult, type StartResult, type QuestionView } from "./engine";
export { MAX_FOLLOWUPS } from "./policy";
