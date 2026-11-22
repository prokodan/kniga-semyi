// Правка черновика главы (I6): поля, лимиты и проверка «цитата — фраза из текста».
// Без server-only: тот же код проверяет форму в браузере и тело PATCH на сервере.
import { z } from "zod";

export const DRAFT_LIMITS = { title: 120, quote: 400, text_ru: 20000 } as const;

export const DraftSchema = z.object({
  title: z.string().trim().min(1, "Нужен заголовок").max(DRAFT_LIMITS.title, `Заголовок — до ${DRAFT_LIMITS.title} знаков`),
  quote: z.string().trim().max(DRAFT_LIMITS.quote, `Цитата — до ${DRAFT_LIMITS.quote} знаков`),
  text_ru: z.string().trim().min(1, "Текст главы не может быть пустым").max(DRAFT_LIMITS.text_ru, "Текст слишком длинный"),
});

export type DraftFields = z.infer<typeof DraftSchema>;

/** Сравнение без регистра, ё/е, кавычек, тире и лишних пробелов: «Помню — как вчера!» ≈ «помню как вчера». */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Цитата должна оставаться фразой из текста. Пустая цитата — без предупреждения. */
export function quoteInText(quote: string, text: string): boolean {
  const q = normalizeForMatch(quote);
  if (!q) return true;
  return ` ${normalizeForMatch(text)} `.includes(` ${q} `);
}

/** Изменилось ли что-то по сравнению с сохранённым (после обрезки пробелов). */
export function draftChanged(saved: { title: string | null; quote: string | null; text_ru: string | null }, next: DraftFields): boolean {
  return (saved.title ?? "").trim() !== next.title || (saved.quote ?? "").trim() !== next.quote || (saved.text_ru ?? "").trim() !== next.text_ru;
}

/** Ответ PATCH /api/stories/:id/edit */
export interface DraftSaveResult {
  storyId: string;
  /** false — правок не было, перевод не перезапускали */
  changed: boolean;
  /** Цитаты нет в тексте — сохранили, но предупреждаем */
  quoteWarning: boolean;
  status: string;
  /** Перевод уже обновлён */
  done: boolean;
  /** ИИ занят — перевод догонит экран главы */
  queued: boolean;
  retryInMinutes?: number;
  message: string;
}
