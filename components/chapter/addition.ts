// #320: плашка «Есть новое дополнение — пересобрать?» — что показать. Без server-only: тест и клиент.
import type { Story } from "@/lib/types";

export interface AdditionView {
  /** Последний ответ на уточнение — показываем, чтобы правленую главу можно было дополнить руками */
  answer: string;
  question: string;
  /** Семья правила главу: пересборка заменит правку текста — предупредить */
  edited: boolean;
}

const MAX_ANSWER = 600;

/** null — плашки нет: флаг выключен, глава не готова или дополнение уже в тексте. */
export function additionView(
  story: Pick<Story, "status" | "text_ru" | "followups" | "parent_story_id"> & { addition_pending?: boolean },
  opts: { on: boolean; edited: boolean },
): AdditionView | null {
  if (!opts.on || !story.addition_pending || story.parent_story_id || story.status !== "ready" || !story.text_ru) return null;
  const last = [...(story.followups ?? [])].reverse().find((f) => f.answer?.trim());
  if (!last) return null;
  const answer = last.answer.trim();
  return {
    answer: answer.length > MAX_ANSWER ? `${answer.slice(0, MAX_ANSWER).trimEnd()}…` : answer,
    question: last.question?.trim() ?? "",
    edited: opts.edited,
  };
}

export const ADDITION_TEXT = {
  title: "Есть новое дополнение",
  lead: "Рассказчик ответил на уточнение уже после того, как глава была собрана. В тексте главы этого пока нет.",
  rebuild: "Пересобрать главу с дополнением",
  plain: "Глава соберётся заново вместе с дополнением — около минуты. Перевод обновится сам.",
  edited:
    "Вы уже правили эту главу. При пересборке текст напишется заново вместе с дополнением — ваши правки текста заменятся. " +
    "Имена и места из словаря семьи сохранятся. Если правки важны — лучше впишите дополнение руками.",
  editedRebuild: "Всё равно пересобрать",
  byHand: "Вписать руками",
  confirm: "Точно пересобрать? Ваши правки текста заменятся.",
  busy: "Пересобираем…",
  failed: "Не получилось начать пересборку. Попробуйте ещё раз через минуту.",
} as const;
