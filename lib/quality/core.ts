// #352: чистая логика банка проверок — без базы и без ИИ (тесты lib/quality/core.test.ts).
import { createHash } from "node:crypto";
import type { BookLang } from "@/lib/types";
import {
  EMPTY_COUNTERS,
  NUANCE_TAGS,
  PAIR_PACK,
  isNuanceTag,
  pairLangs,
  type BankBucket,
  type CardCounters,
  type NuanceTag,
  type QualityPair,
  type QualityPersona,
  type QualityStatus,
} from "./types";

/** Колонка «Банка»: архив — по статусу; проверены — есть хоть один отзыв; в проверке — есть ссылка; иначе новые. */
export function bucketOf(status: QualityStatus, c: CardCounters = EMPTY_COUNTERS): BankBucket {
  if (status === "archived") return "archived";
  if (c.reviewed > 0) return "reviewed";
  if (c.links > 0) return "review";
  return "new";
}

/** Языки книги для прогона личности боевым конвейером (как у семьи): ru-ko → ru,ko; ru-kk → ru,kk; kk-ru → kk,ru. */
export function bookLangsOf(pair: QualityPair): BookLang[] {
  const { from, to } = pairLangs(pair);
  return [from, to];
}

/** Пакеты банка вопросов личности (как у семьи с флагом culture_packs): general + слой; koryo у eval — банк V0. */
export function packsOf(pack: string): string[] {
  const p = pack.trim().toLowerCase();
  if (!p || p === "general") return ["general"];
  return ["general", ...p.split(/[+,\s]+/).filter((x) => x && x !== "general")];
}

/**
 * Markdown личности для persona_reply (формат eval/personas/*.md). У seed из eval bio — уже готовый markdown
 * (начинается с «# »). Иначе собираем: заголовок, языки книги и пакеты, манера речи, биография.
 */
export function personaMarkdown(p: Pick<QualityPersona, "name" | "pair" | "pack" | "bio" | "speech_style">): string {
  if (/^# /.test(p.bio.trimStart())) return p.bio.trim();
  const langs = bookLangsOf(p.pair).join(",");
  const packs = packsOf(p.pack)
    .map((x) => `\`${x}\``)
    .join(" + ");
  return [
    `# ${p.name}`,
    "",
    "Вымышленный персонаж для проверки качества. Все совпадения случайны.",
    "",
    `- книга: \`${langs}\` · пакеты: ${packs}`,
    "",
    "## Манера речи",
    p.speech_style.trim() || "Говорит просто, как пожилой человек.",
    "",
    "## Биография",
    p.bio.trim(),
  ].join("\n");
}

/** Детерминированный UUID по ключу сида (повторный сид — те же id). */
export function seedUuid(key: string): string {
  const h = createHash("sha256").update(`quality-seed:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 17), 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** Теги из формы / ответа модели: только известные, без повторов, в порядке NUANCE_TAGS не меняем — как пришли. */
export function cleanTags(raw: readonly unknown[]): NuanceTag[] {
  const out: NuanceTag[] = [];
  for (const t of raw) {
    const v = typeof t === "string" ? t.trim().toLowerCase() : "";
    if (isNuanceTag(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Фокус-слова: только те, что реально есть в тексте (иначе проверяющему нечего подсвечивать), ≤ 8. */
export function cleanFocus(raw: readonly unknown[], text: string): string[] {
  const out: string[] = [];
  const low = text.toLowerCase();
  for (const t of raw) {
    const v = typeof t === "string" ? t.trim() : "";
    if (v.length < 2 || v.length > 80 || out.includes(v)) continue;
    if (low.includes(v.toLowerCase())) out.push(v);
    if (out.length >= 8) break;
  }
  return out;
}

/** «Сгенерировать N»: по ≤ 2 штуки на вызов, вызовы параллельно (каждый укладывается в 60 с функции). */
export const GENERATE_MAX = 6;
export function generateCalls(n: number, perCall = 2): number[] {
  const total = Math.max(1, Math.min(GENERATE_MAX, Math.round(n)));
  const calls: number[] = [];
  for (let left = total; left > 0; left -= perCall) calls.push(Math.min(perCall, left));
  return calls;
}

/**
 * Теги для вызова генерации: выбранные в форме; ничего не выбрано — по кругу те, которых в банке пары меньше всего
 * (банк ровнее: по 2–3 текста на тег).
 */
export function tagsForCall(selected: readonly NuanceTag[], counts: Partial<Record<NuanceTag, number>>, i: number): NuanceTag[] {
  if (selected.length) return [...selected];
  const order = [...NUANCE_TAGS].sort((a, b) => (counts[a] ?? 0) - (counts[b] ?? 0) || NUANCE_TAGS.indexOf(a) - NUANCE_TAGS.indexOf(b));
  return [order[i % order.length]!];
}

/** Сколько текстов на каждый тег (активные и новые — без архива). */
export function tagCounts(texts: readonly { nuance_tags: readonly string[]; status: QualityStatus }[]): Partial<Record<NuanceTag, number>> {
  const out: Partial<Record<NuanceTag, number>> = {};
  for (const t of texts) {
    if (t.status === "archived") continue;
    for (const tag of t.nuance_tags) if (isNuanceTag(tag)) out[tag] = (out[tag] ?? 0) + 1;
  }
  return out;
}

export function defaultPack(pair: QualityPair): string {
  return PAIR_PACK[pair];
}

/** Средняя оценка по отзывам: все числовые 1–5 в ratings / criteria (Q2 может добавить свои оси). */
export function avgRating(rows: readonly { ratings?: unknown; criteria?: unknown; skipped?: boolean | null }[]): number | null {
  let sum = 0;
  let n = 0;
  for (const r of rows) {
    if (r.skipped) continue;
    for (const obj of [r.ratings, r.criteria]) {
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) continue;
      for (const v of Object.values(obj as Record<string, unknown>)) {
        if (typeof v === "number" && v >= 1 && v <= 5) {
          sum += v;
          n += 1;
        }
      }
    }
  }
  return n ? Math.round((sum / n) * 10) / 10 : null;
}

/** Ручной ввод личности / текста из формы — проверка (сообщение — по-русски, для админки). */
export function validateManualPersona(i: { name: string; bio: string; speech_style: string }): string | null {
  if (i.name.trim().length < 2) return "Укажите имя личности.";
  if (wordCount(i.bio) < 20) return "Биография — хотя бы 20 слов: годы, места, родня.";
  return null;
}

export function validateManualText(i: { text_src: string; tags: readonly NuanceTag[] }): string | null {
  const w = wordCount(i.text_src);
  if (w < 40) return `Текст слишком короткий (${w} слов) — нужно 100–250.`;
  if (w > 400) return `Текст слишком длинный (${w} слов) — нужно 100–250.`;
  if (!i.tags.length) return "Отметьте хотя бы один тег нюансов.";
  return null;
}
