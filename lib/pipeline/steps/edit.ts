// Шаг 2: бережная редактура → text_ru, title, quote, facts.
// Вход — слова рассказчика: основной ответ + его ответы на уточнения (тексты наших уточнений не добавляем).
// #98: сначала собираем источник главы — приклеиваем записи-уточнения, которые интервью не успело добавить,
// и убираем предложения, уже рассказанные в более ранней главе (одна история — одна глава).
import { LIFE_BLOCKS, type LifeBlock, type Story } from "@/lib/types";
import { entitiesForEdit } from "../entities";
import { attachChildren, dropRepeats, fullSource, joinParts } from "../sources";
import type { StepFn } from "./context";
import { StepError, StepSkip } from "./context";

export function editSource(story: Pick<Story, "transcript" | "followups">): string {
  return fullSource(story);
}

export const edit: StepFn = async ({ story, ai, repo, bank, deadline }) => {
  const kids = repo.children ? await repo.children(story) : [];
  const { followups, added } = attachChildren(story.followups ?? [], kids);
  const parts = [story.transcript ?? "", ...followups.map((f) => f.answer)];
  if (!joinParts(parts)) throw new StepError("Нет текста для главы — расшифровка пустая");

  const earlier = repo.earlier ? await repo.earlier(story) : [];
  const deduped = dropRepeats(
    parts,
    earlier.map((e) => ({ id: e.id, source: fullSource(e) })),
  );
  const transcript = joinParts(deduped.parts);
  const keep = added ? { followups } : {};
  if (!transcript) {
    // Весь ответ — пересказ уже готовой главы: вторую копию не собираем, запись остаётся в базе.
    throw new StepSkip(`Повтор рассказа из другой главы (${deduped.repeatsOf.map((id) => id.slice(0, 8)).join(", ")}) — отдельная глава не нужна`, keep);
  }
  const block = (LIFE_BLOCKS as readonly string[]).includes(story.block ?? "") ? (story.block as LifeBlock) : null;
  const questionText = story.question_id ? (bank.get(story.question_id)?.ru ?? "") : "";
  const storytellerName = await repo.storytellerName(story.storyteller_id);
  const hints = repo.nameHints ? await repo.nameHints(story) : undefined;
  // #102: кто есть кто в прошлых главах (словарь семьи) — чтобы «армянского» снова стало «Олега»
  const entities = repo.familyEntities ? entitiesForEdit(await repo.familyEntities(story)) : [];
  const out = await ai.run(
    "edit",
    { transcript, storytellerName, questionText, block, ...(hints?.length ? { hints } : {}), ...(entities.length ? { entities } : {}) },
    { storyId: story.id, deadline },
  );
  return { ...keep, text_ru: out.text_ru, title: out.title, quote: out.quote, facts: out.facts };
};
