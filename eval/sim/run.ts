// Цикл симуляции: персонаж (ai.run("persona_reply")) ↔ интервью-агент I10 (createInterview),
// затем главы из собранных историй (edit + translate) и сверка «Ключевых фактов».
// Всё в памяти: MemoryInterviewRepo, без базы. ИИ — только через переданный роутер.
import type { AiRouter } from "@/lib/ai/router";
import { AiUnavailableError, type AiStep } from "@/lib/ai/types";
import type { QuestionBank } from "@/lib/interview/bank";
import { createInterview, type AnswerResult } from "@/lib/interview/engine";
import type { SessionState } from "@/lib/interview/policy";
import { MemoryInterviewRepo } from "@/lib/interview/repo";
import type { LifeBlock, Story } from "@/lib/types";
import { SimBudgetError, withBudget } from "./budget";
import { checkFacts, type FactCheck } from "./facts";
import type { Persona } from "./persona";

/** Вызовов ИИ на один ход интервью: persona_reply + completeness + next_question. */
const TURN_COST = 3;
/** Вызовов ИИ на одну главу: edit + translate. */
const CHAPTER_COST = 2;
const HISTORY_MAX = 40; // контракт persona_reply

export type TurnRole = "agent" | "followup" | "persona" | "note";

export interface Turn {
  role: TurnRole;
  text: string;
  questionId?: string;
}

export type QuestionOutcome = "answered" | "skipped" | "later" | "offtopic" | "not_finished";

export interface QuestionStat {
  id: string;
  block: LifeBlock;
  text: string;
  followups: number;
  outcome: QuestionOutcome;
}

export interface Chapter {
  storyId: string;
  questionId: string | null;
  block: LifeBlock | null;
  transcript: string;
  title?: string;
  text_ru?: string;
  quote?: string;
  title_ko?: string;
  text_ko?: string;
  quote_ko?: string;
  error?: string;
}

export interface SimResult {
  persona: Persona;
  behavior: string | undefined;
  mode: string;
  startedAt: string;
  turns: Turn[];
  questions: QuestionStat[];
  chapters: Chapter[];
  /** Факты в главах (то, что попадёт в книгу) */
  factsInChapters: FactCheck[];
  /** Факты в самом разговоре — чтобы отличить «не рассказал» от «потерял редактор» */
  factsInDialog: FactCheck[];
  aiCalls: { used: number; limit: number; byStep: Partial<Record<AiStep, number>> };
  /** Почему остановились раньше конца банка (null — интервью завершено агентом) */
  stoppedBy: null | "questions" | "budget" | "ai_unavailable";
  stopDetail?: string;
}

export interface SimOptions {
  persona: Persona;
  behavior?: string;
  /** Сколько основных вопросов задать (по умолчанию — весь банк, если хватает лимита) */
  maxQuestions?: number;
  /** Лимит вызовов ИИ на прогон (по умолчанию без лимита — для mock) */
  maxCalls?: number;
  ai: Pick<AiRouter, "run">;
  /** Свой банк (тесты); по умолчанию — content/questions */
  bank?: QuestionBank;
  mode?: string;
  now?: () => Date;
}

const FAMILY = "sim-family";
const TOKEN = "sim-token";
const STORYTELLER = "sim-storyteller";

function combined(story: Story): string {
  return [story.transcript ?? "", ...(story.followups ?? []).map((f) => f.answer)].filter((p) => p.trim()).join("\n\n");
}

export async function runSimulation(opts: SimOptions): Promise<SimResult> {
  const now = opts.now ?? (() => new Date());
  const budget = withBudget(opts.ai, opts.maxCalls);
  const repo = new MemoryInterviewRepo();
  repo.addFamily(FAMILY, TOKEN, [STORYTELLER]);
  repo.names.set(STORYTELLER, opts.persona.name);
  const interview = createInterview({ ai: budget.ai, repo, bank: opts.bank });
  const maxQuestions = opts.maxQuestions ?? Number.POSITIVE_INFINITY;

  const turns: Turn[] = [];
  const history: { q: string; a: string }[] = [];
  const stats = new Map<string, QuestionStat>();
  let stoppedBy: SimResult["stoppedBy"] = null;
  let stopDetail: string | undefined;

  const mainStories = () => [...repo.stories.values()].filter((s) => !s.parent_story_id);
  /** Агент задаёт основной вопрос (с фразой-связкой). Возвращает текст, который слышит рассказчик. */
  const ask = (q: { id: string; block: LifeBlock; ru: string }, bridge = "") => {
    if (!stats.has(q.id)) stats.set(q.id, { id: q.id, block: q.block, text: q.ru, followups: 0, outcome: "not_finished" });
    const text = bridge ? `${bridge} ${q.ru}` : q.ru;
    turns.push({ role: "agent", text, questionId: q.id });
    return text;
  };

  const start = await interview.startSession({ familyId: FAMILY, storytellerId: STORYTELLER, mode: "family", token: TOKEN });
  turns.push({ role: "note", text: start.greeting });
  let questionId = start.question.id;
  let asked = ask(start.question);

  for (;;) {
    // Резерв на главы: каждая уже собранная история + та, что может появиться на этом ходу.
    const reserve = CHAPTER_COST * (mainStories().length + 1);
    if (budget.used() + TURN_COST + reserve > budget.limit) {
      stoppedBy = "budget";
      stopDetail = `осталось ${budget.remaining()} из ${budget.limit} запросов — оставлены на главы`;
      break;
    }

    let res: AnswerResult;
    try {
      const reply = await budget.ai.run("persona_reply", {
        persona: opts.persona.markdown,
        behavior: opts.behavior,
        question: asked,
        history: history.slice(-HISTORY_MAX),
      });
      const answer = reply.answer.trim() || "…";
      turns.push({ role: "persona", text: answer, questionId });
      history.push({ q: asked, a: answer });
      res = await interview.submitAnswer(start.sessionId, { text: answer }, { token: TOKEN });
    } catch (e) {
      if (e instanceof AiUnavailableError || e instanceof SimBudgetError) {
        stoppedBy = e instanceof SimBudgetError ? "budget" : "ai_unavailable";
        stopDetail = e.message;
        break;
      }
      throw e;
    }

    if (res.type === "followup") {
      stats.get(questionId)!.followups += 1;
      turns.push({ role: "followup", text: res.text, questionId });
      asked = res.text;
      continue;
    }
    if (res.type === "finished") {
      turns.push({ role: "note", text: res.message });
      break;
    }

    const next = res.type === "nextQuestion" ? res.question : res.nextQuestion;
    if (res.type === "blockDone") turns.push({ role: "note", text: res.message });
    if (res.type === "nextQuestion" && res.pause) turns.push({ role: "note", text: "(тёплая пауза)" });
    if (!next) break;
    if (!stats.has(next.id) && stats.size >= maxQuestions) {
      stoppedBy = "questions";
      stopDetail = `задано ${stats.size} вопросов (--questions ${maxQuestions})`;
      break;
    }
    questionId = next.id;
    asked = ask(next, res.bridge);
  }

  // Исход по каждому вопросу — из состояния сессии агента.
  const session = await repo.getSession(start.sessionId);
  const state = (session?.state ?? {}) as SessionState;
  const offtopicQuestions = new Set(
    turns.filter((t) => t.role === "followup" && t.text.startsWith("Какая история!")).map((t) => t.questionId),
  );
  for (const s of stats.values()) {
    if (state.answered_question_ids?.includes(s.id)) s.outcome = "answered";
    else if (state.skipped_question_ids?.includes(s.id)) s.outcome = "skipped";
    else if (state.later_question_ids?.includes(s.id)) s.outcome = offtopicQuestions.has(s.id) ? "offtopic" : "later";
    else if (offtopicQuestions.has(s.id)) s.outcome = "offtopic";
  }

  // Главы: каждая основная история → edit → translate. Ответы на уточнения уже в followups.
  const chapters: Chapter[] = [];
  for (const story of mainStories()) {
    const transcript = combined(story);
    const ch: Chapter = { storyId: story.id, questionId: story.question_id, block: story.block, transcript };
    chapters.push(ch);
    if (!transcript.trim()) continue;
    try {
      const q = story.question_id ? interview.bank.get(story.question_id) : undefined;
      const edited = await budget.ai.run("edit", {
        transcript,
        storytellerName: opts.persona.name,
        questionText: q?.ru ?? "Рассказ вне вопроса",
        block: story.block,
      });
      Object.assign(ch, { title: edited.title, text_ru: edited.text_ru, quote: edited.quote });
      const tr = await budget.ai.run("translate", { text_ru: edited.text_ru, title: edited.title, quote: edited.quote });
      Object.assign(ch, { title_ko: tr.title_ko, text_ko: tr.text_ko, quote_ko: tr.quote_ko });
    } catch (e) {
      if (!(e instanceof AiUnavailableError || e instanceof SimBudgetError)) throw e;
      ch.error = e.message;
    }
  }

  const chapterText = chapters.map((c) => [c.title, c.text_ru, c.quote].filter(Boolean).join("\n")).join("\n\n");
  const dialogText = turns.filter((t) => t.role === "persona").map((t) => t.text).join("\n");

  return {
    persona: opts.persona,
    behavior: opts.behavior,
    mode: opts.mode ?? "mock",
    startedAt: now().toISOString(),
    turns,
    questions: [...stats.values()],
    chapters,
    factsInChapters: checkFacts(opts.persona.keyFacts, chapterText),
    factsInDialog: checkFacts(opts.persona.keyFacts, dialogText),
    aiCalls: { used: budget.used(), limit: budget.limit, byStep: budget.byStep() },
    stoppedBy,
    stopDetail,
  };
}
