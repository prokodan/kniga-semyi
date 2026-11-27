// #232: чистая логика ссылок носителей — токен, абзацы, проверка отзыва, статистика. Без server-only (тесты, скрипты).
import { createHash, randomBytes } from "node:crypto";
import {
  REVIEW_AXES,
  REVIEW_PAIRS,
  type BookLang,
  type ReviewFeedback,
  type ReviewItem,
  type ReviewLink,
  type ReviewMode,
  type ReviewPair,
  type ReviewRatings,
} from "@/lib/types";

/** Токен ссылки: 32 символа base64url (192 бита). В базе — только sha256. */
export function newReviewToken(): string {
  return randomBytes(24).toString("base64url");
}

export const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

export function hashReviewToken(token: string): string {
  return createHash("sha256").update(`review|${token}`).digest("hex");
}

export function isReviewPair(v: string): v is ReviewPair {
  return (REVIEW_PAIRS as readonly string[]).includes(v);
}

export function pairLangs(pair: ReviewPair): { from: BookLang; to: BookLang } {
  const [from, to] = pair.split("-") as [BookLang, BookLang];
  return { from, to };
}

export const MODES: readonly ReviewMode[] = ["texts", "questions"];

/** Абзацы текста: по переводам строк, пустые — выкидываем. */
export function paragraphs(text: string): string[] {
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Пары абзацев «оригинал | перевод». Разное число абзацев — лишние идут с пустой парой. */
export function alignParagraphs(source: string, target: string): { source: string; target: string }[] {
  const a = paragraphs(source);
  const b = paragraphs(target);
  const n = Math.max(a.length, b.length);
  return Array.from({ length: n }, (_, i) => ({ source: a[i] ?? "", target: b[i] ?? "" }));
}

/** Инициалы проверяющего: «Айгерим К.» → «А. К.»; уже инициалы — как есть (до 16 символов). */
export function reviewerLabel(raw: string): string {
  const parts = raw
    .replace(/[^\p{L}\s.-]/gu, " ")
    .split(/[\s.]+/)
    .filter(Boolean);
  if (!parts.length) return "";
  return parts
    .slice(0, 3)
    .map((p) => `${p[0]!.toUpperCase()}.`)
    .join(" ")
    .slice(0, 16);
}

/** Кратко для имени файла выгрузки: «А. К.» → «ak». Латиница — как есть, кириллица / хангыль — транслитом по первой букве. */
export function labelSlug(label: string): string {
  const map: Record<string, string> = {
    А: "a", Б: "b", В: "v", Г: "g", Д: "d", Е: "e", Ё: "e", Ж: "zh", З: "z", И: "i", Й: "i", К: "k", Л: "l", М: "m", Н: "n",
    О: "o", П: "p", Р: "r", С: "s", Т: "t", У: "u", Ф: "f", Х: "h", Ц: "ts", Ч: "ch", Ш: "sh", Щ: "sch", Ы: "y", Э: "e", Ю: "yu",
    Я: "ya", Ә: "a", Ғ: "g", Қ: "q", Ң: "n", Ө: "o", Ұ: "u", Ү: "u", Һ: "h", І: "i",
  };
  const out = label
    .toUpperCase()
    .split("")
    .map((c) => (/[A-Z0-9]/.test(c) ? c.toLowerCase() : (map[c] ?? (/\p{L}/u.test(c) ? "x" : ""))))
    .join("");
  return out || "x";
}

export function linkStatus(link: Pick<ReviewLink, "expires_at" | "revoked_at">, now: Date = new Date()): "active" | "expired" | "revoked" {
  if (link.revoked_at) return "revoked";
  return new Date(link.expires_at).getTime() <= now.getTime() ? "expired" : "active";
}

// ---------------- отзыв от носителя ----------------

export const LIMITS = { text: 8000, comment: 2000 } as const;

export interface FeedbackInput {
  item_id: string;
  paragraph: number;
  edited_text: string | null;
  ratings: ReviewRatings;
  comment: string | null;
  skipped: boolean;
}

export class FeedbackError extends Error {}

function cleanText(v: unknown, max: number, what: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") throw new FeedbackError(`${what}: нужна строка`);
  const t = v.replace(/\r\n?/g, "\n").trim();
  if (t.length > max) throw new FeedbackError(`${what}: длиннее ${max} символов`);
  return t || null;
}

/** Проверка тела запроса страницы носителя. Неизвестные поля игнорируем, плохие — ошибка. */
export function parseFeedback(body: unknown): FeedbackInput {
  if (!body || typeof body !== "object") throw new FeedbackError("пустой запрос");
  const b = body as Record<string, unknown>;
  const item_id = typeof b.item_id === "string" && /^[0-9a-f-]{36}$/i.test(b.item_id) ? b.item_id : null;
  if (!item_id) throw new FeedbackError("item_id");
  const paragraph = typeof b.paragraph === "number" && Number.isInteger(b.paragraph) && b.paragraph >= -1 && b.paragraph < 500 ? b.paragraph : null;
  if (paragraph === null) throw new FeedbackError("paragraph");
  const ratings: ReviewRatings = {};
  if (b.ratings !== undefined && b.ratings !== null) {
    if (typeof b.ratings !== "object") throw new FeedbackError("ratings");
    for (const axis of REVIEW_AXES) {
      const v = (b.ratings as Record<string, unknown>)[axis];
      if (v === undefined || v === null) continue;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 5) throw new FeedbackError(`ratings.${axis}: 1–5`);
      ratings[axis] = v;
    }
  }
  if (paragraph >= 0 && Object.keys(ratings).length) throw new FeedbackError("оценки — только на весь текст (paragraph = -1)");
  const edited_text = cleanText(b.edited_text, LIMITS.text, "edited_text");
  if (paragraph < 0 && edited_text) throw new FeedbackError("правка — только для абзаца");
  return {
    item_id,
    paragraph,
    edited_text,
    ratings,
    comment: cleanText(b.comment, LIMITS.comment, "comment"),
    skipped: b.skipped === true,
  };
}

// ---------------- статистика для /admin/reviews ----------------

export interface LinkStats {
  items: number;
  /** Текстов с любым отзывом (оценка, правка, комментарий, пропуск) */
  reviewed: number;
  skipped: number;
  edits: number;
  comments: number;
  /** Средние по осям (только оценённые) */
  avg: Partial<Record<(typeof REVIEW_AXES)[number], number>>;
  lastAt: string | null;
}

/** Правка абзаца — только если текст отличается от модели (после нормализации пробелов). */
export function isRealEdit(model: string, edited: string | null | undefined): edited is string {
  if (!edited) return false;
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  return norm(model) !== norm(edited);
}

export function linkStats(items: Pick<ReviewItem, "id" | "model_text">[], feedback: ReviewFeedback[]): LinkStats {
  const ids = new Set(items.map((i) => i.id));
  const model = new Map(items.map((i) => [i.id, i.model_text]));
  const fb = feedback.filter((f) => ids.has(f.item_id));
  const touched = new Set<string>();
  const sums: Record<string, { s: number; n: number }> = {};
  let skipped = 0;
  let edits = 0;
  let comments = 0;
  let lastAt: string | null = null;
  for (const f of fb) {
    const para = f.paragraph >= 0 ? paragraphs(model.get(f.item_id) ?? "")[f.paragraph] ?? "" : "";
    const edit = f.paragraph >= 0 && isRealEdit(para, f.edited_text);
    const rated = Object.keys(f.ratings ?? {}).length > 0;
    if (edit || rated || f.comment || f.skipped) touched.add(f.item_id);
    if (f.skipped && f.paragraph < 0) skipped++;
    if (edit) edits++;
    if (f.comment) comments++;
    for (const [axis, v] of Object.entries(f.ratings ?? {})) {
      if (typeof v !== "number") continue;
      (sums[axis] ??= { s: 0, n: 0 }).s += v;
      sums[axis]!.n++;
    }
    if (!lastAt || f.updated_at > lastAt) lastAt = f.updated_at;
  }
  const avg: LinkStats["avg"] = {};
  for (const axis of REVIEW_AXES) {
    const x = sums[axis];
    if (x?.n) avg[axis] = Math.round((x.s / x.n) * 10) / 10;
  }
  return { items: items.length, reviewed: touched.size, skipped, edits, comments, avg, lastAt };
}
