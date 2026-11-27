// Культурные пакеты банка вопросов (#230, docs/v2/LANGUAGES.md §2): костяк general + слои-патчи.
import type { LifeBlock } from "@/lib/types";

/** Языки, на которых пишутся тексты вопросов. */
export type PackLang = "ru" | "ko" | "kk";
export type PackText = { ru: string } & Partial<Record<Exclude<PackLang, "ru">, string>>;

/** Вопрос костяка или вопрос, который слой добавляет. */
export interface PackQuestion {
  id: string;
  block: LifeBlock;
  text: PackText;
  /** Минимум полноты ответа (что должно прозвучать) */
  minimum: string[];
}

/** Патч слоя к костяку. Порядок операций внутри слоя = порядок применения. */
export type PackOp =
  /** Вставить вопрос сразу после `after` (после уже добавленных к нему же — в порядке слоёв) */
  | { op: "add"; after: string; question: PackQuestion }
  /** Переформулировать вопрос (смысл тот же); `minimum` — заменить минимум формулировкой этой культуры */
  | { op: "reword"; id: string; text: Partial<PackText>; minimum?: string[] }
  /** Дополнить минимум полноты */
  | { op: "minimum+"; id: string; add: string[] }
  /** Скрыть вопрос костяка */
  | { op: "hide"; id: string };

export interface CulturePack {
  id: string;
  /** Как пакет называется для семьи */
  title: string;
  ops: PackOp[];
  /** Слова и реалии культуры для расшифровки, редактуры и перевода. Глоссарий корё-сарам пока живёт в docs/glossary.md. */
  glossary?: { file?: string; words?: { term: string; meaning: string }[] };
  /** Термины родства → отношение древа (#235): «нағашы ата» → «дедушка по маме» */
  kinship?: { term: string; relation: string }[];
  /** Подсказки расшифровке: имена, места */
  hints?: string[];
  /** Трудные темы: только в hardship, не первыми, с разрешением не отвечать */
  sensitive?: { topic: string; questionIds?: string[] }[];
  /** Правила обращения для вопросов и перевода */
  tone?: string[];
}
