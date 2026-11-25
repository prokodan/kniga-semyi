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
  /** Цитата отличается от текста только написанием — без предупреждения, «исправлено написание» */
  quoteSpelling?: boolean;
  status: string;
  /** Перевод уже обновлён */
  done: boolean;
  /** ИИ занят — перевод догонит экран главы */
  queued: boolean;
  retryInMinutes?: number;
  message: string;
}

// ---------------- исправление написания vs новое ----------------
// «У штабе» → «Уштобе», «Ким Чер су» → «Ким Чер Су» — это правка написания: нейтральное «исправлено написание».
// Предупреждаем только о новом: словах и числах, которых не было ни в главе, ни в расшифровке рассказчика.

/** Слова текста для сравнения: нижний регистр, ё → е, без знаков. */
export function words(s: string): string[] {
  return normalizeForMatch(s).split(" ").filter(Boolean);
}

const squash = (ws: string[]) => ws.join("");
const digits = (s: string) => s.replace(/\D+/g, "");

/** Расстояние Левенштейна (короткие строки). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}

/** Допуск правки написания: ~1 буква на 4, но не меньше 1 и не больше 4; числа должны совпасть. */
function spellingLike(from: string, to: string): boolean {
  if (!from || !to) return false;
  if (digits(from) !== digits(to)) return false;
  const limit = Math.min(4, Math.max(1, Math.floor(Math.max(from.length, to.length) / 4)));
  return editDistance(from, to) <= limit;
}

/**
 * Лучшее совпадение фразы внутри текста с точностью до правки написания (без пробелов и знаков).
 * Возвращает число правок (0 — точное совпадение) — алгоритм Селлерса, приблизительный поиск подстроки.
 */
function approxFind(needle: string, hay: string): number {
  if (!needle) return 0;
  let prev = new Array<number>(hay.length + 1).fill(0);
  for (let i = 1; i <= needle.length; i++) {
    const cur = [i];
    for (let j = 1; j <= hay.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (needle[i - 1] === hay[j - 1] ? 0 : 1));
    prev = cur;
  }
  return Math.min(...prev);
}

export type QuoteMatch = "exact" | "spelling" | "missing";

/** Цитата — фраза из текста: точно, с точностью до написания (нейтрально) или её нет (предупреждение). */
export function quoteMatch(quote: string, text: string): QuoteMatch {
  if (quoteInText(quote, text)) return "exact";
  const q = squash(words(quote));
  const t = squash(words(text));
  const qDigits = digits(quote);
  if (qDigits && !digits(text).includes(qDigits)) return "missing";
  const limit = Math.min(6, Math.max(1, Math.floor(q.length / 8)));
  return approxFind(q, t) <= limit ? "spelling" : "missing";
}

export interface DraftDiff {
  /** Правки написания: «у штабе» → «уштобе» */
  spelling: { from: string; to: string }[];
  /** Новые слова и числа, которых не было ни в главе, ни в расшифровке */
  added: string[];
}

/** Общие начало и конец отбрасываем — обычно правка короткая; на середину — LCS по словам. */
function hunks(a: string[], b: string[]): { removed: string[]; added: string[] }[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);
  if (x.length * y.length > 4_000_000) return [{ removed: x, added: y }]; // переписан целиком — без LCS
  const dp = Array.from({ length: x.length + 1 }, () => new Uint16Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--) dp[i]![j] = x[i] === y[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: { removed: string[]; added: string[] }[] = [];
  let cur = { removed: [] as string[], added: [] as string[] };
  const flush = () => {
    if (cur.removed.length || cur.added.length) out.push(cur);
    cur = { removed: [], added: [] };
  };
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      flush();
      i++;
      j++;
    } else if (j < y.length && (i >= x.length || dp[i]![j + 1]! >= dp[i + 1]![j]!)) cur.added.push(y[j++]!);
    else cur.removed.push(x[i++]!);
  }
  flush();
  return out;
}

/** Короткие служебные слова — их добавление не «новый факт». */
const FILLER = new Set("и а но да же ли бы не ни в во на с со к ко о об от до по за из у я он она мы они это то так вот уже ещё еще тоже".split(" "));

/** Чем отличается новый текст главы от сохранённого: правки написания и действительно новое. */
export function diffDraft(before: string, after: string, sources: (string | null | undefined)[] = []): DraftDiff {
  const known = new Set(sources.flatMap((s) => words(s ?? "")).concat(words(before)));
  const knownSquashed = sources.map((s) => squash(words(s ?? ""))).join(" ");
  const isKnown = (w: string) =>
    known.has(w) || FILLER.has(w) || (w.length >= 4 && !/\d/.test(w) && approxFind(w, knownSquashed) <= Math.max(1, Math.floor(w.length / 5)));

  const diff: DraftDiff = { spelling: [], added: [] };
  for (const h of hunks(words(before), words(after))) {
    if (!h.added.length) continue; // удалили — не новое
    if (h.removed.length && spellingLike(squash(h.removed), squash(h.added))) {
      diff.spelling.push({ from: h.removed.join(" "), to: h.added.join(" ") });
      continue;
    }
    const fresh = h.added.filter((w) => !isKnown(w));
    if (fresh.length) diff.added.push(h.added.join(" "));
    else if (h.removed.length) diff.spelling.push({ from: h.removed.join(" "), to: h.added.join(" ") });
  }
  return diff;
}
