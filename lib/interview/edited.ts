// #149: «семья правила главу» — отметка для интервью и конвейера: такую главу сами не пересобираем (правка не
// перетирается), ответ на позднее / отложенное уточнение только дописывается в followups.
// Отметка — story_texts.origin = 'family' у строки ru (колонка из #230, значение 'family' предусмотрено схемой).
// Пересборка с edit обнуляет text_ru → зеркало stories_mirror_texts удаляет строку ru, новая встаёт с origin 'ai' —
// отметка снимается сама. Без миграции. Нет таблицы / ошибка — «не правили» (как до #149).
import type { SupabaseClient } from "@supabase/supabase-js";

/** Глава старше этого — ответ на уточнение только дописываем, не пересобираем (= LATE_CHILD_REBUILD_MS конвейера, #98). */
export const SETTLED_CHAPTER_MS = 30 * 60_000;

export async function familyEditedIn(db: SupabaseClient, storyId: string): Promise<boolean> {
  const { data, error } = await db.from("story_texts").select("origin").eq("story_id", storyId).eq("lang", "ru").maybeSingle();
  if (error || !data) return false;
  return (data as { origin?: string }).origin === "family";
}

export async function markFamilyEditedIn(db: SupabaseClient, storyId: string): Promise<void> {
  const { error } = await db.from("story_texts").update({ origin: "family" }).eq("story_id", storyId).eq("lang", "ru");
  if (error) console.warn(`[draft] отметка правки ${storyId.slice(0, 8)}:`, error.message); // нет таблицы до migrate — не страшно
}

/**
 * Глава уже собрана и «устоялась»: старше 30 мин или её правила семья. Ответ на уточнение к такой главе — только в
 * followups (войдёт при следующей пересборке), автоматически не пересобираем.
 */
export function settledChapter(story: { text_ru?: string | null; created_at: string }, edited: boolean, now: number): boolean {
  if (!story.text_ru) return false;
  return edited || now - new Date(story.created_at).getTime() > SETTLED_CHAPTER_MS;
}
