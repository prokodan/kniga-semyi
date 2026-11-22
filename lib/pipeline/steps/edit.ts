// Шаг 2: бережная редактура → text_ru, title, quote, facts.
// Вход — слова рассказчика: основной ответ + его ответы на уточнения (тексты наших уточнений не добавляем).
import { LIFE_BLOCKS, type LifeBlock, type Story } from "@/lib/types";
import type { StepFn } from "./context";
import { StepError } from "./context";

export function editSource(story: Pick<Story, "transcript" | "followups">): string {
  const parts = [story.transcript ?? "", ...(story.followups ?? []).map((f) => f.answer)];
  return parts.map((p) => p.trim()).filter(Boolean).join("\n\n");
}

export const edit: StepFn = async ({ story, ai, repo, bank, deadline }) => {
  const transcript = editSource(story);
  if (!transcript) throw new StepError("Нет текста для главы — расшифровка пустая");
  const block = (LIFE_BLOCKS as readonly string[]).includes(story.block ?? "") ? (story.block as LifeBlock) : null;
  const questionText = story.question_id ? (bank.get(story.question_id)?.ru ?? "") : "";
  const storytellerName = await repo.storytellerName(story.storyteller_id);
  const hints = repo.nameHints ? await repo.nameHints(story) : undefined;
  const out = await ai.run("edit", { transcript, storytellerName, questionText, block, ...(hints?.length ? { hints } : {}) }, { storyId: story.id, deadline });
  return { text_ru: out.text_ru, title: out.title, quote: out.quote, facts: out.facts };
};
