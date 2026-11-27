// Интервью-агент: после каждого ответа проверяет полноту (ai.run("completeness")), задаёт до 3 тёплых
// уточнений про конкретный пробел, умеет «пропустить / вернуться позже», засчитывает рассказ «не по теме»
// в подходящий блок и выбирает следующий вопрос (ai.run("next_question")). Состояние — sessions.state.
// Один механизм для семьи и киоска (sessions.mode). Без базы и ключей работает на Memory + mock.
//
// Здесь нет server-only: движок собирается из зависимостей, чтобы его гоняли тесты и симулятор (I15).
// Боевая сборка с ai-роутером и Supabase — lib/interview/index.ts.
import type { AiRouter } from "@/lib/ai/router";
import { AiUnavailableError, type AiOutput } from "@/lib/ai/types";
import type { LifeBlock, Question, SessionMode, Story } from "@/lib/types";
import { getQuestionBank, type QuestionBank } from "./bank";
import {
  addUnique,
  blockTransition,
  candidateQuestions,
  cleanBridge,
  coveredBlocks,
  decideAfterCompleteness,
  detectSignal,
  isBlockDone,
  isClosed,
  KNOWN_ANSWER_CHARS,
  KNOWN_ANSWERS,
  MAX_FOLLOWUPS,
  pushAsked,
  pushRecent,
  REFUSE_STORY_WORDS,
  removeValue,
  wordCount,
  type SessionState,
} from "./policy";
import { applyName, findUncertain, resolveName } from "./names";
import type { DeferredAsk, InterviewRepo } from "./repo";

export type InterviewErrorCode = "bad_request" | "forbidden" | "not_found" | "finished" | "not_ready";

export class InterviewError extends Error {
  constructor(
    readonly code: InterviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "InterviewError";
  }
}

export interface QuestionView {
  id: string;
  block: LifeBlock;
  blockTitle: { ru: string; ko: string };
  ru: string;
  ko: string;
}

export interface Progress {
  blocksDone: number;
  blocksTotal: number;
  questionsDone: number;
  questionsTotal: number;
  /** #101: разделы, пройденные целиком (✓ в полосе разделов) */
  doneBlocks: LifeBlock[];
  /** #101: «Вопрос 2 из 5 в разделе» — место текущего вопроса в его разделе; null — интервью завершено */
  block: { id: LifeBlock; position: number; total: number } | null;
  /** #101: «уточнение 1 из 3» — сколько уточнений по текущему вопросу уже задано и сколько можно всего */
  followups: { asked: number; max: number };
}

export type AnswerResult =
  | { type: "followup"; questionId: string; text: string; followupsLeft: number; storyId: string | null; progress: Progress }
  | {
      type: "nextQuestion";
      question: QuestionView;
      bridge: string;
      /** Трудная тема: UI показывает тёплую паузу и кнопку «вернуться позже» */
      pause: boolean;
      storyId: string | null;
      progress: Progress;
    }
  | {
      type: "blockDone";
      block: LifeBlock;
      blockTitle: { ru: string; ko: string };
      message: string;
      /** Предложить собрать главу из историй блока (I3) */
      suggestChapter: true;
      nextQuestion: QuestionView | null;
      bridge: string;
      storyId: string | null;
      progress: Progress;
    }
  | { type: "finished"; message: string; storyId: string | null; progress: Progress };

export interface StartResult {
  sessionId: string;
  mode: SessionMode;
  question: QuestionView;
  greeting: string;
  progress: Progress;
}

export type AnswerInput = { text: string; storyId?: undefined } | { storyId: string; text?: undefined };

export interface InterviewDeps {
  ai: Pick<AiRouter, "run">;
  repo: InterviewRepo;
  bank?: QuestionBank;
}

const PHRASES = {
  greeting: "Здравствуйте! Мы будем просто разговаривать — отвечайте, как вам удобно. Любой вопрос можно пропустить.",
  // #108: рассказчик уже отвечал раньше — продолжаем с первого неотвеченного вопроса
  welcomeBack: "Здравствуйте! Рады снова вас слышать. Продолжим с того места, где остановились. Любой вопрос можно пропустить.",
  // Начало фразы — как в eval/prompt-checks.ts (ENGINE_BRIDGES): фраза движка, а не модели.
  refused: "Хорошо, не будем об этом — это ваше право, и спасибо, что сказали. Давайте о другом.",
  skip: "Хорошо, давайте о другом.",
  later: "Хорошо, вернёмся к этому, когда захотите.",
  // #107: запись сохранена, расшифровка ещё идёт — ответ засчитан, идём дальше без уточнений
  saved: "Спасибо, рассказ сохранён. Давайте дальше.",
  // #140: уточнение, отложенное после поздней расшифровки, — в конце раздела (этой или следующей сессии)
  backTo: (question: string) => `Давайте ненадолго вернёмся к вопросу «${question}» — хочу кое-что уточнить.`,
  pause: "Спасибо, что поделились этим. Давайте немного передохнём — к этой теме можно вернуться позже, когда захотите.",
  blockDone: (title: string) => `Глава «${title}» собрана. Можно собрать её сейчас или продолжить разговор.`,
  finished: "Спасибо вам огромное! Все вопросы позади — теперь из ваших рассказов соберём книгу.",
};

export function createInterview(deps: InterviewDeps) {
  const { ai, repo } = deps;
  const bank = deps.bank ?? getQuestionBank();

  const view = (q: Question): QuestionView => ({ id: q.id, block: q.block, blockTitle: bank.blockTitle(q.block), ru: q.ru, ko: q.ko });

  function progress(state: SessionState): Progress {
    const all = bank.all();
    const blocks = new Set(all.map((q) => q.block));
    const doneBlocks = coveredBlocks(bank, state);
    const current = state.current_question_id ? bank.get(state.current_question_id) : undefined;
    let block: Progress["block"] = null;
    if (current && !state.finished) {
      const inBlock = bank.inBlock(current.block);
      const closed = inBlock.filter((q) => q.id !== current.id && isClosed(state, q.id)).length;
      block = { id: current.block, position: Math.min(closed + 1, inBlock.length), total: inBlock.length };
    }
    return {
      blocksDone: doneBlocks.length,
      blocksTotal: blocks.size,
      questionsDone: all.filter((q) => isClosed(state, q.id)).length,
      questionsTotal: all.length,
      doneBlocks,
      block,
      followups: { asked: state.followups_asked ?? 0, max: MAX_FOLLOWUPS },
    };
  }

  async function load(sessionId: string, token?: string) {
    const session = await repo.getSession(sessionId);
    if (!session) throw new InterviewError("not_found", "Сессия не найдена");
    if (token !== undefined && !(await repo.checkFamilyToken(session.family_id, token))) {
      throw new InterviewError("forbidden", "Ссылка семьи не подходит к этой сессии");
    }
    const state = structuredClone(session.state ?? {}) as SessionState;
    if (state.finished || session.ended_at) throw new InterviewError("finished", "Интервью уже завершено");
    const question = state.current_question_id ? bank.get(state.current_question_id) : undefined;
    if (!question) throw new InterviewError("not_found", "Текущий вопрос не найден в банке");
    return { session, state, question };
  }

  /**
   * Всё, что сказал рассказчик по вопросу: основной ответ + ответы на уточнения. Тексты самих
   * уточнений не добавляем — иначе модель засчитает «где/когда» из нашего же вопроса.
   */
  function combinedAnswer(story: Story | null, fallback: string): string {
    if (!story) return fallback;
    const parts = [story.transcript ?? ""];
    for (const f of story.followups ?? []) parts.push(f.answer);
    return parts.filter((p) => p.trim()).join("\n\n") || fallback;
  }

  /** Прошлые ответы рассказчика (все сессии семьи, если хранилище умеет; иначе последние в сессии). */
  async function knownAnswers(storytellerId: string, state: SessionState): Promise<string[]> {
    let list: string[] = [];
    if (repo.earlierAnswers) {
      try {
        list = await repo.earlierAnswers(storytellerId);
      } catch {
        list = [];
      }
    }
    if (list.length === 0) list = state.recent_answers ?? [];
    return list
      .map((a) => a.trim().slice(0, KNOWN_ANSWER_CHARS))
      .filter(Boolean)
      .slice(-KNOWN_ANSWERS);
  }

  /** #140: первое отложенное конвейером уточнение, которое в этой сессии ещё не задавали. Ошибка / нет колонки — null. */
  async function pickDeferred(storytellerId: string, state: SessionState): Promise<{ ask: DeferredAsk; question: Question } | null> {
    if (!repo.deferredFollowups) return null;
    try {
      const asked = state.deferred_asked ?? [];
      for (const ask of await repo.deferredFollowups(storytellerId)) {
        const question = bank.get(ask.questionId);
        if (question && !asked.includes(ask.storyId)) return { ask, question };
      }
    } catch (e) {
      console.warn("[interview] отложенные уточнения:", (e as Error).message);
    }
    return null;
  }

  /** #140: сделать отложенное уточнение текущим: ответ на него допишется в followups своего рассказа (answeringFollowup). */
  function askDeferred(state: SessionState, d: { ask: DeferredAsk; question: Question }): QuestionView {
    state.current_question_id = d.question.id;
    state.current_story_id = d.ask.storyId;
    state.pending_followup = d.ask.text;
    state.followups_asked = 1;
    state.asked_followups = pushAsked(state, d.ask.text);
    state.answered_question_ids = addUnique(state.answered_question_ids, d.question.id);
    state.deferred_asked = addUnique(state.deferred_asked, d.ask.storyId);
    // Экран показывает и озвучивает question.ru — подставляем текст уточнения; вопрос целиком — в мосте.
    return { ...view(d.question), ru: d.ask.text };
  }

  /** Переход к следующему вопросу (или blockDone / finished). Сбрасывает счётчики текущего вопроса. */
  async function advance(
    sessionId: string,
    state: SessionState,
    prev: Question,
    opts: {
      storyteller: string;
      storytellerId: string;
      bridge?: string;
      pause?: boolean;
      storyId: string | null;
      wasBlockDone: boolean;
      /** #204: семья — в ai_usage.family_id (расход next_question на книгу, #105 п. 6) */
      familyId?: string;
    },
  ): Promise<AnswerResult> {
    // #140: уходим с отложенного уточнения (ответили, пропустили, «позже») — больше его не задаём.
    const leaving = state.current_story_id;
    if (leaving && (state.deferred_asked ?? []).includes(leaving)) {
      try {
        await repo.updateStory(leaving, { deferred_followup: null });
      } catch (e) {
        console.warn("[interview] снять отложенное уточнение:", (e as Error).message);
      }
    }
    state.followups_asked = 0;
    state.current_story_id = null;
    state.pending_followup = null;
    state.emotional_pause = Boolean(opts.pause);
    state.covered_blocks = coveredBlocks(bank, state);
    const blockJustDone = !opts.wasBlockDone && isBlockDone(bank, state, prev.block);

    // #99: только вопросы текущего раздела; раздел закрыт — следующий по порядку фаз.
    let candidates = candidateQuestions(bank, state, prev.id, prev.block);
    // Остался только отложенный «позже» текущий вопрос — предлагаем его снова (кроме трудной темы).
    if (candidates.length === 0 && !opts.pause && !isClosed(state, prev.id)) candidates = [prev];
    let next: Question | null = null;
    let modelBridge = "";
    if (candidates.length > 0) {
      next = candidates[0]!;
      try {
        const known = await knownAnswers(opts.storytellerId, state);
        const pick = await ai.run("next_question", {
          storytellerName: opts.storyteller,
          coveredBlocks: state.covered_blocks,
          recentAnswers: state.recent_answers ?? [],
          candidateQuestions: candidates.map((q) => ({ id: q.id, block: q.block, text: q.ru })),
          sameBlock: true,
          ...(known.length > 0 ? { knownAnswers: known } : {}),
        }, opts.familyId ? { familyId: opts.familyId } : undefined);
        // #99 п. 2: уже отвеченное в прошлых рассказах не спрашиваем (не больше 2 за раз — страховка от ошибки модели).
        const answeredBefore = (pick.alreadyAnswered ?? [])
          .filter((id) => candidates.some((q) => q.id === id) && id !== prev.id)
          .slice(0, 2);
        for (const id of answeredBefore) state.covered_question_ids = addUnique(state.covered_question_ids, id);
        const rest = candidates.filter((q) => !answeredBefore.includes(q.id));
        const chosen = rest.find((q) => q.id === pick.questionId);
        if (chosen) {
          next = chosen;
          modelBridge = cleanBridge(pick.bridge);
        } else if (rest.length > 0) {
          next = rest[0]!; // id не из кандидатов — модель ошиблась, берём первый
        } else {
          // Весь остаток раздела уже рассказан — следующий раздел по порядку, без второго вызова ИИ.
          const after = candidateQuestions(bank, state, prev.id, prev.block);
          next = after[0] ?? null;
        }
      } catch (e) {
        if (!(e instanceof AiUnavailableError)) throw e; // ИИ недоступен — просто идём по порядку банка
      }
    }
    state.covered_blocks = coveredBlocks(bank, state);
    // #99 п. 4: при смене раздела — мост-переход движка; похвала прошлой теме — только внутри раздела.
    let bridge = opts.bridge ?? modelBridge;
    if (next && next.block !== prev.block) bridge = [opts.bridge, blockTransition(next.block)].filter(Boolean).join(" ");

    // #140: конец раздела (или всего интервью) — сначала уточнения, отложенные после поздней расшифровки (#107).
    // После трудной темы не давим.
    let nextView: QuestionView | null = next ? view(next) : null;
    if ((!next || next.block !== prev.block) && !opts.pause) {
      const d = await pickDeferred(opts.storytellerId, state);
      if (d) {
        nextView = askDeferred(state, d);
        next = d.question;
        bridge = [opts.bridge, PHRASES.backTo(d.question.ru)].filter(Boolean).join(" ");
      }
    }

    if (!next || !nextView) {
      state.finished = true;
      delete state.current_question_id;
      await repo.saveState(sessionId, state, true);
      return { type: "finished", message: PHRASES.finished, storyId: opts.storyId, progress: progress(state) };
    }

    state.current_question_id = next.id;
    state.covered_blocks = coveredBlocks(bank, state);
    await repo.saveState(sessionId, state);
    if (blockJustDone) {
      const title = bank.blockTitle(prev.block);
      return {
        type: "blockDone",
        block: prev.block,
        blockTitle: title,
        message: PHRASES.blockDone(title.ru),
        suggestChapter: true,
        nextQuestion: nextView,
        bridge,
        storyId: opts.storyId,
        progress: progress(state),
      };
    }
    return { type: "nextQuestion", question: nextView, bridge, pause: Boolean(opts.pause), storyId: opts.storyId, progress: progress(state) };
  }

  /** Проверка полноты и решение: уточнение / уход в другую тему / ответ принят. */
  async function checkCompleteness(
    sessionId: string,
    state: SessionState,
    question: Question,
    main: Story,
    answer: string,
    ctx: { name: string; storytellerId: string; wasBlockDone: boolean; answeringFollowup: boolean },
  ): Promise<AnswerResult> {
    const { name, storytellerId, wasBlockDone, answeringFollowup } = ctx;
    let res: AiOutput<"completeness">;
    // Прошлые ответы (без текущего) — чтобы уточнение не спрашивало уже рассказанное.
    const earlier = (state.recent_answers ?? []).slice(0, -1).map((a) => a.slice(0, KNOWN_ANSWER_CHARS));
    try {
      res = await ai.run(
        "completeness",
        {
          questionText: question.ru,
          block: question.block,
          minimum: question.minimum,
          answer: answer,
          followupsAsked: state.followups_asked ?? 0,
          maxFollowups: MAX_FOLLOWUPS,
          ...((state.asked_followups ?? []).length > 0 ? { askedFollowups: state.asked_followups } : {}),
          ...(earlier.length > 0 ? { earlierAnswers: earlier } : {}),
        },
        { storyId: main.id, familyId: main.family_id },
      );
    } catch (e) {
      if (!(e instanceof AiUnavailableError)) throw e;
      // ИИ недоступен — принимаем ответ как есть, разговор не останавливаем.
      // #99 п. 5: короткий ответ всё равно получает одно уточнение — запасное, без ИИ.
      res = { covered: [], missing: [], followup: null, done: true, offTopicBlock: null };
    }

    const decision = decideAfterCompleteness(res, { question, state, answeringFollowup, bank, answer });

    if (decision.kind === "followup") {
      state.pending_followup = decision.text;
      state.asked_followups = pushAsked(state, decision.text);
      state.followups_asked = (state.followups_asked ?? 0) + 1;
      state.emotional_pause = false;
      await repo.saveState(sessionId, state);
      return {
        type: "followup",
        questionId: question.id,
        text: decision.text,
        followupsLeft: MAX_FOLLOWUPS - state.followups_asked,
        storyId: main.id,
        progress: progress(state),
      };
    }

    if (decision.kind === "offtopic") {
      // Рассказ не теряем: он уходит в свой блок и не считается ответом на текущий вопрос.
      await repo.updateStory(main.id, { block: decision.block, question_id: null });
      state.offtopic_blocks = addUnique(state.offtopic_blocks, decision.block);
      state.current_story_id = null;
      if (decision.returnText) {
        state.followups_asked = (state.followups_asked ?? 0) + 1;
        state.emotional_pause = false;
        await repo.saveState(sessionId, state);
        return {
          type: "followup",
          questionId: question.id,
          text: decision.returnText,
          followupsLeft: MAX_FOLLOWUPS - state.followups_asked,
          storyId: main.id,
          progress: progress(state),
        };
      }
      state.later_question_ids = addUnique(state.later_question_ids, question.id);
      return advance(sessionId, state, question, { storyteller: name, storytellerId, storyId: main.id, wasBlockDone, familyId: main.family_id });
    }

    state.answered_question_ids = addUnique(state.answered_question_ids, question.id);
    state.later_question_ids = removeValue(state.later_question_ids, question.id);
    return advance(sessionId, state, question, { storyteller: name, storytellerId, storyId: main.id, wasBlockDone, familyId: main.family_id });
  }

  /**
   * #107: голосовой ответ записан, но расшифровка не успела (≈ 50 с) или нажали «не ждать». Это ответ, а не пропуск:
   * запись привязывается к вопросу (или к основной истории, если это ответ на уточнение), вопрос засчитан.
   * Уточнений нет — проверять полноту нечем. Главу соберёт конвейер, когда расшифровка будет готова
   * (вопрос закрыт → interviewHold её не держит).
   */
  async function skipRecorded(
    sessionId: string,
    ctx: { session: { id: string; family_id: string; storyteller_id: string }; state: SessionState; question: Question; name: string; wasBlockDone: boolean },
    recordedId: string,
  ): Promise<AnswerResult> {
    const { session, state, question, name, wasBlockDone } = ctx;
    const rec = await repo.getStory(recordedId);
    if (!rec || rec.family_id !== session.family_id) throw new InterviewError("not_found", "История не найдена");
    const mainId = state.current_story_id ?? null;
    let release: string | null;
    if (mainId && mainId !== rec.id) {
      // ответ на уточнение: основной рассказ уже есть — запись приклеивается к нему (конвейер #98 допишет её в главу)
      if (!rec.parent_story_id) await repo.updateStory(rec.id, { parent_story_id: mainId });
      release = mainId;
    } else {
      const patch = { question_id: rec.question_id ?? question.id, block: rec.block ?? question.block, parent_story_id: null };
      await repo.updateStory(rec.id, patch);
      // #140: полноту проверит конвейер, когда будет расшифровка. Отдельной записью: колонки может ещё не быть
      // (до migrate) — тогда всё как в #107, без уточнения.
      try {
        await repo.updateStory(rec.id, { deferred_followup: { status: "pending", question_id: patch.question_id } });
      } catch (e) {
        console.warn("[interview] отложить проверку полноты:", (e as Error).message);
      }
      // ещё расшифровывается — главу запустит сам конвейер; уже расшифрована — собрать сейчас
      release = rec.transcript?.trim() ? rec.id : null;
    }
    state.answered_question_ids = addUnique(state.answered_question_ids, question.id);
    state.skipped_question_ids = removeValue(state.skipped_question_ids, question.id);
    state.later_question_ids = removeValue(state.later_question_ids, question.id);
    state.name_check = null;
    return advance(sessionId, state, question, { storyteller: name, storytellerId: session.storyteller_id, bridge: PHRASES.saved, storyId: release, wasBlockDone, familyId: session.family_id });
  }

  async function storytellerName(session: { storyteller_id: string }) {
    // Имя нужно только для фразы-связки; без него next_question работает.
    return repo.storytellerName ? await repo.storytellerName(session.storyteller_id) : "";
  }

  return {
    bank,

    /**
     * Начать сессию без вызова ИИ: первый вопрос банка, а если рассказчик уже отвечал в прошлых сессиях (#108) —
     * первый неотвеченный по порядку фаз; отвеченные засчитаны в answered_question_ids.
     */
    async startSession(input: {
      familyId: string;
      storytellerId: string;
      mode?: SessionMode;
      volunteerId?: string | null;
      token?: string;
    }): Promise<StartResult> {
      if (input.token !== undefined && !(await repo.checkFamilyToken(input.familyId, input.token))) {
        throw new InterviewError("forbidden", "Ссылка семьи не подходит");
      }
      if (!(await repo.storytellerBelongs(input.familyId, input.storytellerId))) {
        throw new InterviewError("forbidden", "Рассказчик не из этой семьи");
      }
      let answered: string[] = [];
      if (repo.answeredQuestionIds) {
        try {
          const ids = new Set(await repo.answeredQuestionIds(input.storytellerId));
          answered = bank.all().filter((q) => ids.has(q.id)).map((q) => q.id);
        } catch {
          answered = []; // база не ответила — начинаем с первого вопроса, как раньше
        }
      }
      const state: SessionState = {
        current_question_id: undefined,
        followups_asked: 0,
        covered_blocks: [],
        skipped_question_ids: [],
        later_question_ids: [],
        answered_question_ids: answered,
        current_story_id: null,
        pending_followup: null,
        recent_answers: [],
      };
      // Всё уже рассказано — начинаем сначала: можно дополнить любой ответ.
      // #140: отложенные уточнения прошлых сессий здесь не задаём — телефон и киоск при старте сами пролистывают
      // уже отвеченные вопросы («skip»); их задаст advance() в конце первого же раздела.
      const first = candidateQuestions(bank, state)[0] ?? bank.first();
      state.current_question_id = first.id;
      state.covered_blocks = coveredBlocks(bank, state);
      const mode = input.mode ?? "family";
      const session = await repo.createSession({
        family_id: input.familyId,
        storyteller_id: input.storytellerId,
        mode,
        volunteer_id: input.volunteerId ?? null,
        state,
      });
      const greeting = answered.length > 0 ? PHRASES.welcomeBack : PHRASES.greeting;
      return { sessionId: session.id, mode, question: view(first), greeting, progress: progress(state) };
    },

    /** Ответ на текущий вопрос или на уточнение: текстом или готовой историей (transcript после I2). */
    async submitAnswer(sessionId: string, input: AnswerInput, opts: { token?: string } = {}): Promise<AnswerResult> {
      const { session, state, question } = await load(sessionId, opts.token);

      let incoming: Story | null = null;
      let text: string;
      if (input.storyId) {
        incoming = await repo.getStory(input.storyId);
        if (!incoming || incoming.family_id !== session.family_id) throw new InterviewError("not_found", "История не найдена");
        if (!incoming.transcript?.trim()) throw new InterviewError("not_ready", "История ещё расшифровывается — попробуйте чуть позже");
        text = incoming.transcript;
      } else {
        text = input.text ?? "";
      }
      if (!text.trim()) throw new InterviewError("bad_request", "Пустой ответ");

      const name = await storytellerName(session);
      const wasBlockDone = isBlockDone(bank, state, question.block);

      // Ответ на «Правильно ли я поняла: Уштобе?» — не часть рассказа: выбираем написание и исправляем им
      // расшифровку и уточнения, затем обычная проверка полноты (переспрос уточнением не считается).
      if (state.name_check && state.current_story_id === state.name_check.storyId) {
        const check = state.name_check;
        let main = await repo.getStory(check.storyId);
        if (!main) throw new InterviewError("not_found", "История текущего вопроса не найдена");
        const chosen = resolveName(text, check);
        const transcript = applyName(main.transcript ?? "", check.heard, chosen);
        const followups = (main.followups ?? []).map((f) => ({ ...f, answer: applyName(f.answer, check.heard, chosen) }));
        await repo.updateStory(main.id, { transcript, followups });
        main = { ...main, transcript, followups };
        // голос «да, Уштобе» в главу и на страницу голоса не идёт
        if (incoming && incoming.id !== main.id) await repo.updateStory(incoming.id, { status: "skipped" });
        state.name_check = null;
        state.pending_followup = null;
        return checkCompleteness(sessionId, state, question, main, combinedAnswer(main, text), {
          name,
          storytellerId: session.storyteller_id,
          wasBlockDone,
          answeringFollowup: followups.length > 0,
        });
      }

      const answeringFollowup = Boolean(state.pending_followup && state.current_story_id);
      const signal = detectSignal(text);

      // Отказ от темы — сразу дальше, без уточнений и без проверки полноты. Длинный рассказ с отказом
      // только в конце («…а про войну не хочу») — это рассказ: засчитываем ниже, но не уточняем.
      const refusesWhole = signal === "refuses" && (answeringFollowup || wordCount(text) <= REFUSE_STORY_WORDS);
      if (refusesWhole) {
        state.recent_answers = pushRecent(state, text);
        let storyId: string | null;
        if (answeringFollowup) {
          // Основной ответ уже есть — засчитываем его, по уточнению не давим. Голос «не хочу» в главу не идёт.
          state.answered_question_ids = addUnique(state.answered_question_ids, question.id);
          if (incoming && incoming.id !== state.current_story_id) await repo.updateStory(incoming.id, { status: "skipped" });
          storyId = state.current_story_id ?? null;
        } else {
          // Вопрос пропущен: запись сохраняем (status skipped), но главой она не становится.
          state.skipped_question_ids = addUnique(state.skipped_question_ids, question.id);
          if (incoming) await repo.updateStory(incoming.id, { status: "skipped", question_id: incoming.question_id ?? question.id, block: incoming.block ?? question.block });
          storyId = null;
        }
        state.later_question_ids = removeValue(state.later_question_ids, question.id);
        return advance(sessionId, state, question, { storyteller: name, storytellerId: session.storyteller_id, bridge: PHRASES.refused, storyId, wasBlockDone, familyId: session.family_id });
      }

      // Сохраняем сказанное до вызова ИИ: если модель упадёт, рассказ не потеряется.
      let main: Story | null;
      if (answeringFollowup) {
        main = await repo.getStory(state.current_story_id!);
        if (!main) throw new InterviewError("not_found", "История текущего вопроса не найдена");
        // #128: запись-уточнение помечаем story_id (#98) — конвейер, который приклеивает «опоздавшие» записи сам,
        // не допишет её второй раз; та же запись уже в followups — не дописываем.
        const recId = incoming && incoming.id !== main.id ? incoming.id : undefined;
        const already = recId !== undefined && (main.followups ?? []).some((f) => f.story_id === recId);
        if (!already) {
          const entry = { question: state.pending_followup!, answer: text.trim(), ...(recId ? { story_id: recId } : {}) };
          const followups = [...(main.followups ?? []), entry];
          await repo.updateStory(main.id, { followups });
          main = { ...main, followups };
        }
        // Голосовой ответ на уточнение — отдельная запись; помечаем её, чтобы конвейер (I2) не делал из неё главу.
        if (incoming && incoming.id !== main.id && !incoming.parent_story_id) {
          await repo.updateStory(incoming.id, { parent_story_id: main.id });
        }
      } else if (incoming) {
        // #128: после offtopic-уточнения телефон шлёт запись с parentStoryId перенесённой истории, но это уже основной
        // ответ на вопрос — связь снимаем, иначе конвейер только расшифрует её и глава не соберётся.
        const patch = { question_id: incoming.question_id ?? question.id, block: incoming.block ?? question.block, parent_story_id: null };
        await repo.updateStory(incoming.id, patch);
        main = { ...incoming, ...patch };
        state.followups_asked = 0;
      } else {
        main = await repo.createStory({
          family_id: session.family_id,
          storyteller_id: session.storyteller_id,
          session_id: session.id,
          question_id: question.id,
          block: question.block,
          transcript: text.trim(),
        });
        state.followups_asked = 0;
      }
      state.current_story_id = main.id;
      state.pending_followup = null;
      state.recent_answers = pushRecent(state, text);

      // Трудная тема: тёплая пауза, предложение вернуться позже, никаких уточнений подряд.
      if (signal === "emotional") {
        state.later_question_ids = addUnique(state.later_question_ids, question.id);
        return advance(sessionId, state, question, { storyteller: name, storytellerId: session.storyteller_id, bridge: PHRASES.pause, pause: true, storyId: main.id, wasBlockDone, familyId: session.family_id });
      }

      if (signal === "refuses") {
        // Длинный рассказ, отказ — про часть: глава есть, уточнений нет.
        state.answered_question_ids = addUnique(state.answered_question_ids, question.id);
        state.later_question_ids = removeValue(state.later_question_ids, question.id);
        return advance(sessionId, state, question, { storyteller: name, storytellerId: session.storyteller_id, bridge: PHRASES.refused, storyId: main.id, wasBlockDone, familyId: session.family_id });
      }

      // Имя или место распознано неуверенно («У штабе» ≈ Уштобе) — один раз переспросить.
      if (!(state.name_checked ?? []).includes(main.id) && repo.nameHints) {
        const hit = findUncertain(text, await repo.nameHints(session.storyteller_id));
        if (hit) {
          state.name_check = { storyId: main.id, ...hit };
          state.name_checked = addUnique(state.name_checked, main.id);
          state.pending_followup = `Правильно ли я поняла: ${hit.guess}?`;
          state.emotional_pause = false;
          await repo.saveState(sessionId, state);
          return {
            type: "followup",
            questionId: question.id,
            text: state.pending_followup,
            followupsLeft: MAX_FOLLOWUPS - (state.followups_asked ?? 0),
            storyId: main.id,
            progress: progress(state),
          };
        }
      }

      return checkCompleteness(sessionId, state, question, main, combinedAnswer(main, text), {
        name,
        storytellerId: session.storyteller_id,
        wasBlockDone,
        answeringFollowup,
      });
    },

    /**
     * «Пропустить» / «вернуться позже» — без уточнений. Если основной ответ уже записан и шли
     * уточнения, «пропустить» означает «хватит уточнять»: ответ засчитывается.
     */
    async skip(sessionId: string, action: "skip" | "later", opts: { token?: string; storyId?: string } = {}): Promise<AnswerResult> {
      const { session, state, question } = await load(sessionId, opts.token);
      const name = await storytellerName(session);
      const wasBlockDone = isBlockDone(bank, state, question.block);
      if (action === "skip" && opts.storyId) return skipRecorded(sessionId, { session, state, question, name, wasBlockDone }, opts.storyId);
      const storyId = state.current_story_id ?? null;
      if (action === "skip" && storyId) {
        state.answered_question_ids = addUnique(state.answered_question_ids, question.id);
        state.later_question_ids = removeValue(state.later_question_ids, question.id);
      } else if (action === "skip") {
        state.skipped_question_ids = addUnique(state.skipped_question_ids, question.id);
        state.later_question_ids = removeValue(state.later_question_ids, question.id);
      } else {
        state.later_question_ids = addUnique(state.later_question_ids, question.id);
      }
      return advance(sessionId, state, question, {
        storyteller: name,
        storytellerId: session.storyteller_id,
        bridge: action === "later" ? PHRASES.later : PHRASES.skip,
        storyId,
        wasBlockDone,
        familyId: session.family_id,
      });
    },
  };
}

export type Interview = ReturnType<typeof createInterview>;
