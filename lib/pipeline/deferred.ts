// #140: ответ засчитан до расшифровки (#107, `interview.skip(…, { storyId })`) — проверки полноты не было.
// Когда расшифровка готова, конвейер проверяет полноту (ai.run("completeness")) тем же решением, что и интервью
// (decideAfterCompleteness). Не хватает минимума → stories.deferred_followup = { status: "ask", text }: интервью
// задаст это уточнение в конце раздела или в начале следующей сессии. Хватает / ошибка → null (как до #140).
// Сбой проверки главу не роняет и не задерживает: глава собирается как раньше, уточнение — лишь бонус.
import type { AiRouter } from "@/lib/ai/router";
import { AiUnavailableError } from "@/lib/ai/types";
import type { QuestionBank } from "@/lib/interview/bank";
import { decideAfterCompleteness, MAX_FOLLOWUPS } from "@/lib/interview/policy";
import type { DeferredFollowup, Story } from "@/lib/types";

/** Проверка ждёт расшифровку основного рассказа (ответы на уточнения сами не проверяются). */
export function needsDeferredCheck(story: Pick<Story, "deferred_followup" | "transcript" | "parent_story_id" | "status">): boolean {
  return story.deferred_followup?.status === "pending" && !story.parent_story_id && story.status !== "skipped" && Boolean(story.transcript?.trim());
}

/** Результат проверки для stories.deferred_followup: ask с текстом уточнения или null. */
export async function checkDeferred(
  story: Story,
  deps: { ai: Pick<AiRouter, "run">; bank: QuestionBank; deadline: number; now?: () => number },
): Promise<DeferredFollowup | null> {
  const qid = story.deferred_followup?.question_id ?? story.question_id;
  const question = qid ? deps.bank.get(qid) : undefined;
  if (!question) return null;
  const answer = [story.transcript ?? "", ...(story.followups ?? []).map((f) => f.answer)].filter((p) => p.trim()).join("\n\n");
  let res;
  try {
    res = await deps.ai.run(
      "completeness",
      { questionText: question.ru, block: question.block, minimum: question.minimum, answer, followupsAsked: 0, maxFollowups: MAX_FOLLOWUPS },
      { storyId: story.id, familyId: story.family_id, deadline: deps.deadline },
    );
  } catch (e) {
    if (!(e instanceof AiUnavailableError)) throw e;
    // ИИ недоступен — как в интервью (#99 п. 5): короткий ответ всё равно получит запасное уточнение.
    res = { covered: [], missing: [], followup: null, done: true, offTopicBlock: null };
  }
  const decision = decideAfterCompleteness(res, { question, state: {}, answeringFollowup: false, bank: deps.bank, answer });
  if (decision.kind !== "followup") return null; // хватает минимума или рассказ про другое — не переспрашиваем
  return { status: "ask", question_id: question.id, text: decision.text, checked_at: new Date((deps.now ?? Date.now)()).toISOString() };
}
