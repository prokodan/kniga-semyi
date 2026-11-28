// #352 (v2 Q1, docs/v2/QUALITY_LOOP.md §1–2): банк проверок контура качества — общие типы и словари.
// Без server-only: тот же код читают /admin/quality, scripts/quality-run.ts и тесты.
import type { BookLang } from "@/lib/types";

/** Языковые пары банка «откуда-куда». Старт — ru-ko и ru-kk; kk-ru — рассказ по-казахски (eval-персонаж kuljamal). */
export const QUALITY_PAIRS = ["ru-ko", "ru-kk", "kk-ru"] as const;
export type QualityPair = (typeof QUALITY_PAIRS)[number];
/** Пары, с которых начинаем (решение Данила); kk-ru — в банке есть, генерация и прогон тоже работают */
export const START_PAIRS: readonly QualityPair[] = ["ru-ko", "ru-kk"];

export const PAIR_RU: Record<QualityPair, string> = {
  "ru-ko": "RU → KR",
  "ru-kk": "RU → KZ",
  "kk-ru": "KZ → RU",
};

export function isQualityPair(v: unknown): v is QualityPair {
  return typeof v === "string" && (QUALITY_PAIRS as readonly string[]).includes(v);
}

export function pairLangs(pair: QualityPair): { from: BookLang; to: BookLang } {
  const [from, to] = pair.split("-") as [BookLang, BookLang];
  return { from, to };
}

/** Культурный пакет личности по умолчанию для пары. */
export const PAIR_PACK: Record<QualityPair, string> = { "ru-ko": "koryo", "ru-kk": "kz", "kk-ru": "kz" };

/** Теги нюансов (§1): каждый текст банка нагружен ими; по 2–3 текста на тег на пару. */
export const NUANCE_TAGS = ["kinship", "grandkids", "dates", "soviet", "dialect", "idioms", "emotions", "names"] as const;
export type NuanceTag = (typeof NUANCE_TAGS)[number];

export const NUANCE_RU: Record<NuanceTag, string> = {
  kinship: "родство",
  grandkids: "обращение к внукам",
  dates: "даты и числа",
  soviet: "советские реалии",
  dialect: "диалектные слова",
  idioms: "идиомы",
  emotions: "эмоции",
  names: "имена и топонимы",
};

export function isNuanceTag(v: unknown): v is NuanceTag {
  return typeof v === "string" && (NUANCE_TAGS as readonly string[]).includes(v);
}

/** Статус строки в базе: new — ещё не прогоняли, active — в прогонах, archived — в архиве. */
export const QUALITY_STATUSES = ["new", "active", "archived"] as const;
export type QualityStatus = (typeof QUALITY_STATUSES)[number];
export const QUALITY_SOURCES = ["seed", "generated", "manual"] as const;
export type QualitySource = (typeof QUALITY_SOURCES)[number];

export const SOURCE_RU: Record<QualitySource, string> = { seed: "сид", generated: "сгенерировано", manual: "вручную" };

/** Колонка «Банка» в админке (§3.1): новые → в проверке → проверены → архив. */
export const BANK_BUCKETS = ["new", "review", "reviewed", "archived"] as const;
export type BankBucket = (typeof BANK_BUCKETS)[number];
export const BUCKET_RU: Record<BankBucket, string> = { new: "Новые", review: "В проверке", reviewed: "Проверены", archived: "Архив" };

export interface QualityPersona {
  id: string;
  pair: QualityPair;
  pack: string;
  name: string;
  bio: string;
  speech_style: string;
  tags: string[];
  status: QualityStatus;
  source: QualitySource;
  seed_key: string | null;
  created_at: string;
}

export interface QualityText {
  id: string;
  pair: QualityPair;
  persona_id: string | null;
  event: string;
  text_src: string;
  nuance_tags: string[];
  focus_terms: string[];
  status: QualityStatus;
  source: QualitySource;
  seed_key: string | null;
  created_at: string;
}

export type QualityKind = "persona" | "text";
export type RunStatus = "ok" | "partial" | "budget" | "error";

export interface QualityRun {
  id: string;
  kind: QualityKind;
  ref_id: string;
  pair: QualityPair;
  commit_sha: string | null;
  prompt_versions: Record<string, string>;
  models: RunModels;
  env: string;
  status: RunStatus;
  calls: number;
  cost_usd: number;
  error: string | null;
  batch: string | null;
  created_at: string;
}

/** Модели прогона: маршруты шагов (ai_routes на момент прогона) и кто реально ответил. */
export interface RunModels {
  routes: Record<string, string[]>;
  used: Record<string, string[]>;
}

export interface QualityItem {
  id: string;
  run_id: string;
  position: number;
  title: string | null;
  src_text: string;
  out_text: string;
  lang_from: string;
  lang_to: string;
  step: string;
  focus_terms: { src: string }[];
}

/** Счётчики карточки (§3.1): прогонов N, ссылок N, проверено N, средняя оценка. */
export interface CardCounters {
  runs: number;
  links: number;
  reviewed: number;
  avg: number | null;
  lastRunAt: string | null;
}

export const EMPTY_COUNTERS: CardCounters = { runs: 0, links: 0, reviewed: 0, avg: null, lastRunAt: null };
