// Правила интервью-агента. Чистые функции без базы и ИИ — их легко проверять тестами.
// Ожидаемое поведение на каждый профиль рассказчика — eval/behaviors.md.
import type { AiOutput } from "@/lib/ai/types";
import type { InterviewState, LifeBlock, Question } from "@/lib/types";
import type { QuestionBank } from "./bank";

/** Не больше 3 уточнений на один вопрос. */
export const MAX_FOLLOWUPS = 3;
/** Сколько последних ответов отдаём в next_question (контракт: ≤ 5). */
export const RECENT_ANSWERS = 5;

/**
 * Полное состояние сессии в `sessions.state` (jsonb). Надмножество `InterviewState` из lib/types:
 * базовые поля те же, остальные — служебные поля агента. Контракт lib/types не меняем (это Z6).
 */
export interface SessionState extends InterviewState {
  answered_question_ids?: string[];
  /** История, в которую копятся ответ и уточнения по текущему вопросу */
  current_story_id?: string | null;
  /** Заданное и ещё не отвеченное уточнение */
  pending_followup?: string | null;
  /** Последний ответ был на трудной теме — подряд уточнений не задаём */
  emotional_pause?: boolean;
  /** Последние ответы (обрезанные) — для фразы-связки next_question */
  recent_answers?: string[];
  /** Блоки, куда засчитаны рассказы «не по теме» (offTopicBlock) */
  offtopic_blocks?: LifeBlock[];
  finished?: boolean;
  /** Переспрос неуверенно распознанного имени / места («Правильно ли я поняла: Уштобе?») — ждём ответ */
  name_check?: { storyId: string; heard: string; guess: string } | null;
  /** Истории, по которым уже переспрашивали (один раз на историю) */
  name_checked?: string[];
}

// ---------------- Сигналы в ответе (без ИИ, бесплатно) ----------------

export type AnswerSignal = "refuses" | "emotional" | null;

// Только 1-е лицо настоящего («не хочу», «не буду»): «мама не хотела об этом говорить» — рассказ, не отказ.
const REFUSE = [
  /не\s+(хочу|буду|стану)\s+(на\s+(это|этот\s+вопрос)\s+|об\s+этом\s+|про\s+(это|неё|нее|него|них)\s+|это\s+|тут\s+)?(отвечать|говорить|вспоминать|рассказывать)/i,
  /не\s+(хочу|буду|стану)\s+(об\s+этом|про\s+это|на\s+это|про\s+(неё|нее|него|них))(?![а-яё])/i,
  /(об\s+этом|про\s+это)\s+(я\s+)?(не\s+(хочу|буду)|говорить\s+не\s+(хочу|буду))/i,
  /(об\s+[а-яё]+|про\s+[а-яё]+)\s+(я\s+)?не\s+(хочу|буду)\s*([.!…,]|$)/i,
  /^[\s.,…!-]*(нет[,.!\s]+)?(не\s+хочу|не\s+буду|не\s+надо)[\s.!…]*$/i,
  /давайте\s+(дальше|другое|о\s+другом|другой\s+вопрос|пропустим)/i,
  /(^|[\s,.])(пропустите|пропустим)(?![а-яё])/i,
  /не\s+спрашивайте/i,
  /без\s+комментариев/i,
];

/** Слов в ответе (для правил «короткий ответ» и «длинный рассказ с отказом в конце»). */
export function wordCount(text: string): number {
  return (text.match(/[а-яёa-z0-9]+/gi) ?? []).length;
}

/** Длинный рассказ, где отказ — только про часть («…а про войну не хочу»): рассказ засчитываем, не давим. */
export const REFUSE_STORY_WORDS = 25;
const EMOTIONAL = [
  /\((плачет|плач|пауза|молчит|всхлип\w*)\)/i,
  /не\s+могу\s+(об\s+этом\s+|про\s+это\s+)?(говорить|вспоминать)/i,
  /тяжело\s+(вспоминать|говорить)/i,
  /сл[её]зы\s+(текут|наворачиваются|душат)/i,
  /простите,?\s+(я\s+)?(сейчас|немного)/i,
];

/** Отказ важнее эмоций: на отказ — сразу дальше, без уточнений. */
export function detectSignal(answer: string): AnswerSignal {
  const text = answer.trim();
  if (REFUSE.some((r) => r.test(text))) return "refuses";
  if (EMOTIONAL.some((r) => r.test(text))) return "emotional";
  return null;
}

// ---------------- Решение после проверки полноты ----------------

export type Decision =
  | { kind: "followup"; text: string }
  | { kind: "offtopic"; block: LifeBlock; returnText: string | null }
  | { kind: "accept" };

/**
 * Короче этого (слов) ответ без единого уточнения не считается полным, даже если модель сказала done:
 * «Жили в Уштобе» (3 слова) сразу становилось главой (пункт 4). Минимум — хотя бы одно уточнение.
 */
export const SHORT_ANSWER_WORDS = 15;

/** Уточнение без ИИ — по первому пункту минимума, которого нет в ответе. Один вопрос, на «вы», без «подробнее». */
export function fallbackFollowup(question: Question, covered: string[]): string {
  const item = question.minimum.find((m) => !covered.includes(m)) ?? question.minimum[0] ?? "";
  if (/год|когда|лет\b|возраст/i.test(item)) return "А примерно в каком году это было?";
  if (/где|место|город|село/i.test(item)) return "А где это было — какое это было место?";
  if (/звали|имя/i.test(item)) return "А как звали этого человека?";
  if (/кто/i.test(item)) return "А кто был рядом с вами тогда?";
  if (/чем\s+занима|работ/i.test(item)) return "А чем тогда занимались в вашей семье?";
  return "А что вам особенно запомнилось — может, какая-то мелочь?";
}

export function decideAfterCompleteness(
  res: AiOutput<"completeness">,
  ctx: { question: Question; state: SessionState; answeringFollowup: boolean; bank: QuestionBank; answer?: string },
): Decision {
  const asked = ctx.state.followups_asked ?? 0;
  const canAsk = asked < MAX_FOLLOWUPS && !ctx.state.emotional_pause;

  // Ушёл в другую тему: рассказ засчитываем в его блок, мягко возвращаем к вопросу.
  if (res.offTopicBlock && res.offTopicBlock !== ctx.question.block && !ctx.answeringFollowup) {
    const title = ctx.bank.blockTitle(res.offTopicBlock).ru;
    return {
      kind: "offtopic",
      block: res.offTopicBlock,
      returnText: canAsk ? `Какая история! Я сохраню её в главу «${title}». А если вернуться к вопросу: ${ctx.question.ru}` : null,
    };
  }
  // Совсем короткий первый ответ — хотя бы одно уточнение, даже если модель решила, что хватит.
  if (canAsk && asked === 0 && !ctx.answeringFollowup && ctx.answer !== undefined && wordCount(ctx.answer) < SHORT_ANSWER_WORDS) {
    return { kind: "followup", text: res.followup?.trim() || fallbackFollowup(ctx.question, res.covered) };
  }
  // Минимум собран (или модель решила не давить) — не перебиваем.
  if (res.done || res.missing.length === 0) return { kind: "accept" };
  if (canAsk && res.followup && res.followup.trim()) return { kind: "followup", text: res.followup.trim() };
  return { kind: "accept" };
}

// ---------------- Блоки и следующий вопрос ----------------

/** Вопрос считается «пройденным», если на него ответили или его пропустили. «Позже» — нет. */
export function isClosed(state: SessionState, id: string): boolean {
  return (state.answered_question_ids ?? []).includes(id) || (state.skipped_question_ids ?? []).includes(id);
}

/** Блок закрыт, когда пройдены все его вопросы. */
export function isBlockDone(bank: QuestionBank, state: SessionState, block: LifeBlock): boolean {
  const qs = bank.inBlock(block);
  return qs.length > 0 && qs.every((q) => isClosed(state, q.id));
}

export function coveredBlocks(bank: QuestionBank, state: SessionState): LifeBlock[] {
  const blocks = new Set(bank.all().map((q) => q.block));
  return [...blocks].filter((b) => isBlockDone(bank, state, b));
}

/**
 * Кандидаты для next_question: первый непройденный вопрос каждого блока (порядок внутри блока
 * = порядок показа из банка). Если всё пройдено — возвращаемся к отложенным «позже».
 */
export function candidateQuestions(bank: QuestionBank, state: SessionState, excludeId?: string): Question[] {
  const later = new Set(state.later_question_ids ?? []);
  const open = bank.all().filter((q) => q.id !== excludeId && !isClosed(state, q.id) && !later.has(q.id));
  const firstPerBlock = new Map<LifeBlock, Question>();
  for (const q of open) if (!firstPerBlock.has(q.block)) firstPerBlock.set(q.block, q);
  if (firstPerBlock.size > 0) return [...firstPerBlock.values()];
  return bank.all().filter((q) => later.has(q.id) && q.id !== excludeId && !isClosed(state, q.id));
}

export function pushRecent(state: SessionState, answer: string): string[] {
  const trimmed = answer.trim().slice(0, 500);
  if (!trimmed) return state.recent_answers ?? [];
  return [...(state.recent_answers ?? []), trimmed].slice(-RECENT_ANSWERS);
}

export function addUnique<T>(list: T[] | undefined, value: T): T[] {
  const l = list ?? [];
  return l.includes(value) ? l : [...l, value];
}

export function removeValue<T>(list: T[] | undefined, value: T): T[] {
  return (list ?? []).filter((v) => v !== value);
}
