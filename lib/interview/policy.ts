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
  /**
   * #296: когда задано текущее уточнение (ISO). Конвейер держит главу, пока уточнение свежее (FOLLOWUP_IDLE_MS):
   * семья закрыла вкладку на уточнении — глава не ждёт 20 минут. Нет (старые сессии) — держим до 20 мин, как раньше.
   */
  followup_at?: string | null;
  /** Последний ответ был на трудной теме — подряд уточнений не задаём */
  emotional_pause?: boolean;
  /** Последние ответы (обрезанные) — для фразы-связки next_question */
  recent_answers?: string[];
  /** Блоки, куда засчитаны рассказы «не по теме» (offTopicBlock) */
  offtopic_blocks?: LifeBlock[];
  finished?: boolean;
  /**
   * #233: культурные пакеты, по которым собран банк этой сессии (general + слои). Нет — банк V0 (как до #233).
   * Пишется при старте сессии и больше не меняется.
   */
  packs?: string[];
  /** Переспрос неуверенно распознанного имени / места («Правильно ли я поняла: Уштобе?») — ждём ответ */
  name_check?: { storyId: string; heard: string; guess: string } | null;
  /** Истории, по которым уже переспрашивали (один раз на историю) */
  name_checked?: string[];
  /** Вопросы, на которые рассказчик уже ответил раньше в других рассказах (#99 п. 2) — не задаём */
  covered_question_ids?: string[];
  /** Все уточнения сессии — не повторять ни дословно, ни по смыслу (#99 п. 3) */
  asked_followups?: string[];
  /** #140: рассказы, чьё отложенное уточнение (stories.deferred_followup) уже задано в этой сессии */
  deferred_asked?: string[];
}

// ---------------- Фазы и порядок разделов (#99) ----------------

/**
 * Фазы интервью: разделы идут строго по порядку, текущий доводим до конца (или «позже» по всем вопросам).
 * Фаза 1 — Корни → Детство → Юность и учёба; фаза 2 — Работа и дело → Любовь и семья → Трудные времена;
 * фаза 3 — Традиции и кухня → Слова внукам. Совпадает с порядком карты жизни (LIFE_BLOCKS) — проверяет тест.
 */
export const BLOCK_PHASES: readonly (readonly LifeBlock[])[] = [
  ["roots", "childhood", "youth"],
  ["work", "love", "hardship"],
  ["traditions", "legacy"],
];
export const BLOCK_ORDER: readonly LifeBlock[] = BLOCK_PHASES.flat();

/** «Теперь давайте поговорим о …» — предложный падеж названия раздела. */
const BLOCK_ABOUT: Record<LifeBlock, string> = {
  roots: "корнях вашей семьи",
  childhood: "вашем детстве",
  youth: "юности и учёбе",
  work: "работе и деле",
  love: "любви и семье",
  hardship: "трудных временах",
  traditions: "традициях и кухне",
  legacy: "том, что вы хотели бы сказать внукам",
};

/**
 * Связка модели без висящего «А…» в конце: вопрос сам начинается с «А …» или с глагола, и получалось
 * «…про Уштобе. А А каким был ваш папа?» (sim 25.11). Оставляем законченную фразу с точкой.
 */
export function cleanBridge(bridge: string): string {
  let b = bridge.trim().replace(/[\s,—-]*(?:^|\s)[АаИи][.…]*$/u, "").trim();
  if (b && !/[.!…]$/.test(b)) b += ".";
  return b;
}

/** Мост при смене раздела. Похвала прошлой теме здесь не уместна (#99 п. 4). */
export function blockTransition(block: LifeBlock): string {
  return `Спасибо! Теперь давайте поговорим о ${BLOCK_ABOUT[block]}.`;
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

/** Запасные уточнения без ИИ: сначала по пробелам минимума, потом общие. Для выбора неповторяющегося. */
export function fallbackFollowups(question: Question, covered: string[]): string[] {
  const missing = question.minimum.filter((m) => !covered.includes(m));
  const out = [...missing, ...question.minimum].map((m) => fallbackFollowup({ ...question, minimum: [m] }, []));
  out.push(
    "А что вам особенно запомнилось — может, какая-то мелочь?",
    "А кто был рядом с вами тогда?",
    "А что вы тогда чувствовали?",
  );
  return [...new Set(out)];
}

// Слова, которые не несут смысла уточнения: «А помните ли вы какую-нибудь…» ≈ «А какая у него была…».
const STOP_STEMS = new Set([
  "помни", "какой", "какая", "какую", "какие", "каким", "какое", "нибуд", "может", "тогда", "было", "была",
  "были", "него", "неё", "нее", "этот", "этого", "этом", "этой", "этим", "расск", "вспом", "запом", "особе",
  "очень", "сейча", "прост", "скажи", "помнит", "вашей", "ваших", "вашем", "ваша", "ваше", "ваши", "вашим",
  "вспоминаете", "много", "чтобы", "котор",
].map((w) => w.slice(0, 5)));

function stems(text: string): Set<string> {
  const words = text.toLowerCase().replace(/ё/g, "е").match(/[а-яa-z]+/g) ?? [];
  return new Set(words.filter((w) => w.length >= 4).map((w) => w.slice(0, 5)).filter((w) => !STOP_STEMS.has(w)));
}

const norm = (t: string) => t.toLowerCase().replace(/ё/g, "е").replace(/[^а-яa-z0-9]+/g, " ").trim();

/**
 * Уточнение уже звучало — дословно или по смыслу (те же значимые слова). Грубо, но бесплатно и без ИИ:
 * «А помните ли вы какую-нибудь его привычку?» и «А какая у него была привычка?» — повтор.
 */
export function isRepeatFollowup(text: string, asked: readonly string[]): boolean {
  const n = norm(text);
  const a = stems(text);
  return asked.some((prev) => {
    if (norm(prev) === n) return true;
    const b = stems(prev);
    if (a.size === 0 || b.size === 0) return false;
    let common = 0;
    for (const w of a) if (b.has(w)) common += 1;
    return common / Math.min(a.size, b.size) >= 0.6;
  });
}

/** Первое уточнение, которого ещё не было: от модели, иначе запасные. null — все варианты уже звучали. */
export function freshFollowup(proposed: string | null | undefined, question: Question, covered: string[], asked: readonly string[]): string | null {
  const options = [proposed?.trim() ?? "", ...fallbackFollowups(question, covered)].filter(Boolean);
  return options.find((t) => !isRepeatFollowup(t, asked)) ?? null;
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
  const already = ctx.state.asked_followups ?? [];
  // Совсем короткий первый ответ — хотя бы одно уточнение, даже если модель решила, что хватит или ИИ недоступен.
  if (canAsk && asked === 0 && !ctx.answeringFollowup && ctx.answer !== undefined && wordCount(ctx.answer) < SHORT_ANSWER_WORDS) {
    const text = freshFollowup(res.followup, ctx.question, res.covered, already);
    if (text) return { kind: "followup", text };
  }
  // Минимум собран (или модель решила не давить) — не перебиваем.
  if (res.done || res.missing.length === 0) return { kind: "accept" };
  if (canAsk && res.followup && res.followup.trim()) {
    // Модель повторила уже заданное уточнение — берём другое по пробелу, а если всё уже звучало — не давим.
    const text = isRepeatFollowup(res.followup, already) ? freshFollowup(null, ctx.question, res.covered, already) : res.followup.trim();
    if (text) return { kind: "followup", text };
  }
  return { kind: "accept" };
}

// ---------------- Блоки и следующий вопрос ----------------

/**
 * Вопрос считается «пройденным», если на него ответили, его пропустили или ответ уже прозвучал раньше
 * в других рассказах (covered_question_ids). «Позже» — нет.
 */
export function isClosed(state: SessionState, id: string): boolean {
  return (
    (state.answered_question_ids ?? []).includes(id) ||
    (state.skipped_question_ids ?? []).includes(id) ||
    (state.covered_question_ids ?? []).includes(id)
  );
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
 * Кандидаты для next_question — только вопросы ОДНОГО раздела (#99): текущего, пока в нём есть открытые
 * вопросы, иначе следующего по порядку фаз. Порядок внутри — как в банке (от лёгкого к личному).
 * Когда всё пройдено — отложенные «позже», тоже по разделам.
 */
export function candidateQuestions(bank: QuestionBank, state: SessionState, excludeId?: string, currentBlock?: LifeBlock): Question[] {
  const later = new Set(state.later_question_ids ?? []);
  const open = bank.all().filter((q) => q.id !== excludeId && !isClosed(state, q.id) && !later.has(q.id));
  const pool = open.length > 0 ? open : bank.all().filter((q) => later.has(q.id) && q.id !== excludeId && !isClosed(state, q.id));
  if (pool.length === 0) return [];
  const rank = (b: LifeBlock) => {
    const i = BLOCK_ORDER.indexOf(b);
    return i < 0 ? BLOCK_ORDER.length : i;
  };
  const block =
    currentBlock && pool.some((q) => q.block === currentBlock)
      ? currentBlock
      : [...pool].sort((a, b) => rank(a.block) - rank(b.block))[0]!.block;
  return pool.filter((q) => q.block === block);
}

/** Ответы прошлых рассказов (обрезанные) для проверки «уже отвечено» и уточнений без повторов. */
export const KNOWN_ANSWERS = 30;
export const KNOWN_ANSWER_CHARS = 300;

export function pushAsked(state: SessionState, text: string): string[] {
  return [...(state.asked_followups ?? []), text.trim()].slice(-30);
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
