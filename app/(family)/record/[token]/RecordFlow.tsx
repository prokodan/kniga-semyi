"use client";
// Интервью голосом: вопрос крупно + озвучка → запись → загрузка → история `uploaded` → следующий вопрос.
// Конвейер I2 гоняем отсюда: POST /api/stories/:id/process по шагу (расшифровка → редактура → перевод),
// пока next !== null и не queued. Очередь вопросов ведёт интервью-агент I10 (/api/sessions): ему нужна
// расшифровка — ждём её недолго и идём дальше (рассказ уже сохранён). Без API интервью — идём по банку сами.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { QUESTIONS } from "@/content/questions/bank";
import { BLOCKS } from "@/content/questions/blocks";
import { postJson, Recorder, UploadError, uploadAudio, type Take } from "@/components/recorder";
import type { LifeBlock } from "@/lib/types";
import { InterviewProgress } from "../../_ui/InterviewProgress";
import { localProgress, type InterviewProgressView } from "../../_ui/progress-line";
import { canSpeak, speak, stopSpeaking, useSpeechBlocked, useSpeechState } from "../../_ui/speak";

interface QuestionView {
  id: string;
  block: LifeBlock;
  blockTitle: { ru: string; ko: string };
  ru: string;
  ko: string;
}

type P = { progress?: InterviewProgressView };
type AnswerResult =
  | ({ type: "followup"; questionId: string; text: string; storyId: string | null } & P)
  | ({ type: "nextQuestion"; question: QuestionView; bridge: string; pause: boolean } & P)
  | ({ type: "blockDone"; message: string; nextQuestion: QuestionView | null; bridge: string } & P)
  | ({ type: "finished"; message: string } & P);

interface Current {
  question: QuestionView;
  /** Что показываем и озвучиваем: вопрос или уточнение агента */
  prompt: string;
  kind: "question" | "followup";
  bridge?: string;
  pause?: boolean;
  /** Для уточнения: основная история вопроса — ответ пишется с parent_story_id */
  mainStoryId?: string | null;
  /** #101: прогресс от движка (вопрос N из M в разделе, уточнения) */
  progress?: InterviewProgressView;
}

interface StepResult {
  next: string | null;
  queued: boolean;
  running?: boolean;
  status: string;
}

type Phase = "loading" | "ask" | "waiting" | "finished";

// Ждём расшифровку до ~50 с (цепочка моделей transcribe может занять 20–45 с): раньше через 25 с вопрос
// «пропускался» без проверки полноты, и короткий ответ сразу становился главой (пункт 4).
const POLL_TRIES = 20;
const MAX_STEPS = 6;
const POLL_MS = 2500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function bankView(q: (typeof QUESTIONS)[number]): QuestionView {
  const b = BLOCKS.find((x) => x.id === q.block);
  return { id: q.id, block: q.block, blockTitle: { ru: b?.ru ?? q.block, ko: b?.ko ?? "" }, ru: q.ru, ko: q.ko };
}

const asQuestion = (q: QuestionView, extra: Partial<Current> = {}): Current => ({ question: q, prompt: q.ru, kind: "question", ...extra });

export function RecordFlow(props: {
  token: string;
  familyId: string;
  storyteller: { id: string; name: string };
  /** Раньше — для полосы «глав начато»; после #101 полосу ведёт прогресс движка. Оставлено для совместимости страницы. */
  initialCovered: LifeBlock[];
  answeredQuestionIds: string[];
}) {
  const { token, familyId, storyteller } = props;
  const storageKey = `ks:interview:${storyteller.id}`;

  const [phase, setPhase] = useState<Phase>("loading");
  const [current, setCurrent] = useState<Current | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [take, setTake] = useState(0); // ключ Recorder — новый вопрос = чистая запись
  const recording = useSpeechBlocked(); // #100: идёт запись — «Прослушать вопрос» недоступна

  const session = useRef<string | null>(null); // null — идём по банку сами
  const local = useRef<{ done: Set<string>; later: string[] }>({ done: new Set(props.answeredQuestionIds), later: [] });
  const dontWait = useRef(false);

  const persist = useCallback(
    (c: Current | null) => {
      try {
        if (session.current && c) localStorage.setItem(storageKey, JSON.stringify({ sessionId: session.current, current: c }));
        else localStorage.removeItem(storageKey);
      } catch {
        /* приватный режим Safari — просто не запоминаем */
      }
    },
    [storageKey],
  );

  const show = useCallback(
    (c: Current | null, msg?: string | null) => {
      setMessage(msg ?? null);
      if (!c) {
        setCurrent(null);
        setPhase("finished");
        persist(null);
        return;
      }
      setCurrent(c);
      setPhase("ask");
      setTake((n) => n + 1);
      persist(c);
    },
    [persist],
  );

  /** Следующий вопрос по банку без агента (запасной путь). */
  const nextLocal = useCallback(
    (msg?: string | null) => {
      const { done, later } = local.current;
      const q = QUESTIONS.find((x) => !done.has(x.id) && !later.includes(x.id)) ?? QUESTIONS.find((x) => later.includes(x.id) && !done.has(x.id));
      if (q) local.current.later = later.filter((id) => id !== q.id);
      show(q ? asQuestion(bankView(q), { progress: localProgress(QUESTIONS, done, q) }) : null, msg ?? (q ? null : "Все вопросы позади — спасибо вам огромное!"));
    },
    [show],
  );

  const apply = useCallback(
    (r: AnswerResult, prev: Current) => {
      switch (r.type) {
        case "followup":
          return show({
            question: prev.question,
            prompt: r.text,
            kind: "followup",
            mainStoryId: r.storyId ?? prev.mainStoryId ?? null,
            progress: r.progress ?? prev.progress,
          });
        case "nextQuestion":
          return show(asQuestion(r.question, { bridge: r.bridge, pause: r.pause, progress: r.progress }));
        case "blockDone":
          return show(r.nextQuestion ? asQuestion(r.nextQuestion, { bridge: r.bridge, progress: r.progress }) : null, r.message);
        case "finished":
          return show(null, r.message);
      }
    },
    [show],
  );

  const sessionCall = useCallback(
    async (path: string, body: Record<string, unknown>) => postJson<AnswerResult>(`/api/sessions/${session.current}/${path}`, token, body),
    [token],
  );

  /** Сессия кончилась или потерялась — начинаем новую. */
  const isGone = (e: unknown) => {
    const err = e as { status?: number; code?: string };
    return err.status === 404 || err.code === "finished";
  };

  const start = useCallback(async () => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const stored = JSON.parse(raw) as { sessionId: string; current: Current };
        if (stored.sessionId && stored.current?.question?.id) {
          session.current = stored.sessionId;
          return show(stored.current);
        }
      }
    } catch {
      /* битое значение — начнём заново */
    }
    try {
      const res = await postJson<{ sessionId: string; question: QuestionView } & P>("/api/sessions", token, { familyId, storytellerId: storyteller.id, mode: "family" });
      session.current = res.sessionId;
      let c = asQuestion(res.question, { progress: res.progress });
      // Новая сессия начинает с первого вопроса — пролистываем те, на которые уже есть рассказы.
      for (let i = 0; i < QUESTIONS.length && local.current.done.has(c.question.id); i++) {
        const r = await sessionCall("skip", { action: "skip" });
        if (r.type === "nextQuestion") c = asQuestion(r.question, { progress: r.progress });
        else if (r.type === "blockDone" && r.nextQuestion) c = asQuestion(r.nextQuestion, { progress: r.progress });
        else return apply(r, c);
      }
      show(c);
    } catch (e) {
      console.warn("[record] интервью-агент недоступен, идём по банку:", e instanceof Error ? e.message : e);
      session.current = null;
      nextLocal();
    }
  }, [apply, familyId, nextLocal, sessionCall, show, storageKey, storyteller.id, token]);

  useEffect(() => {
    const t = setTimeout(() => void start(), 0); // после первой отрисовки: localStorage есть только в браузере
    return () => {
      clearTimeout(t);
      stopSpeaking();
    };
  }, [start]);

  // #169: каждый новый вопрос озвучивается сам, один раз (ключ — текст, а не объект вопроса). Браузер не дал звук
  // без нажатия — через ~1 с кнопка становится «▶ Прослушать вопрос» (useSpeechState → blocked).
  const questionText = current && phase === "ask" ? [current.bridge, current.prompt].filter(Boolean).join(" ") : null;
  const speech = useSpeechState();
  const speechBlocked = Boolean(questionText) && speech.status === "blocked" && speech.text === questionText;
  useEffect(() => {
    if (questionText) speak(questionText, { auto: true });
  }, [questionText]);

  /** Конвейер I2 по шагам. Ошибки не мешают интервью: история перезапускается с того же шага позже. */
  const drive = useCallback(
    async (storyId: string, from?: "edit") => {
      for (let i = 0; i < MAX_STEPS; i++) {
        try {
          const r = await postJson<StepResult>(`/api/stories/${storyId}/process`, token, i === 0 && from ? { from } : {});
          // running — шаг уже ведёт сервер (цепочка after() в /process): дальше он сам, экран можно закрыть
          if (!r.next || r.queued || r.running || r.status === "failed") return;
        } catch (e) {
          console.warn("[record] конвейер:", e instanceof Error ? e.message : e);
          return;
        }
      }
    },
    [token],
  );

  // Главу после уточнений собирает сервер (/api/sessions/:id/answer → releaseAfterInterview), здесь ничего не нужно.

  /** После сохранения рассказа — запустить конвейер и спросить агента, что дальше. */
  async function advanceAfter(storyId: string, prev: Current) {
    void drive(storyId);
    if (!session.current) {
      local.current.done.add(prev.question.id);
      return nextLocal();
    }
    dontWait.current = false;
    try {
      for (let i = 0; i < POLL_TRIES && !dontWait.current; i++) {
        try {
          const r = await sessionCall("answer", { storyId });
          return apply(r, prev);
        } catch (e) {
          if ((e as { code?: string }).code !== "not_ready") throw e;
          await sleep(POLL_MS);
        }
      }
      // Расшифровки пока нет (I2) — рассказ сохранён: засчитываем его ответом (#107) и идём дальше без уточнений.
      apply(await sessionCall("skip", { action: "skip", storyId }), prev);
    } catch (e) {
      if (isGone(e)) {
        persist(null);
        session.current = null;
        local.current.done.add(prev.question.id);
        setPhase("loading");
        return void start();
      }
      console.warn("[record] агент не ответил, идём по банку:", e instanceof Error ? e.message : e);
      session.current = null;
      local.current.done.add(prev.question.id);
      nextLocal();
    }
  }

  async function onSend(t: Take, onProgress: (p: number) => void) {
    if (!current) return;
    stopSpeaking();
    setError(null);
    const prev = current;
    const path = await uploadAudio({ token, storytellerId: storyteller.id, kind: "story", take: t, onProgress });
    const { storyId } = await postJson<{ storyId: string }>("/api/stories", token, {
      storytellerId: storyteller.id,
      path,
      questionId: prev.question.id,
      block: prev.question.block,
      durationSec: t.durationSec || null,
      sessionId: session.current,
      parentStoryId: prev.kind === "followup" ? (prev.mainStoryId ?? null) : null,
    });
    setSaved(prev.kind === "followup" ? "Спасибо! Дополнение сохранено." : "Спасибо! Рассказ сохранён.");
    setPhase("waiting");
    void advanceAfter(storyId, prev);
  }

  async function skip(action: "skip" | "later") {
    if (!current) return;
    stopSpeaking();
    setSaved(null);
    setError(null);
    const prev = current;
    if (!session.current) {
      if (action === "skip") local.current.done.add(prev.question.id);
      else local.current.later.push(prev.question.id);
      return nextLocal(action === "later" ? "Хорошо, вернёмся к этому позже." : null);
    }
    setPhase("loading");
    try {
      const r = await sessionCall("skip", { action });
      apply(r, prev); // фразу «вернёмся позже» агент отдаёт в bridge
    } catch (e) {
      if (isGone(e)) {
        persist(null);
        setPhase("loading");
        return void start();
      }
      setError(e instanceof UploadError ? e.message : "Не получилось перейти к другому вопросу. Попробуйте ещё раз.");
      setPhase("ask");
    }
  }

  function listen() {
    if (!current || recording) return;
    speak([current.bridge, current.prompt].filter(Boolean).join(" "));
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-5 px-5 py-6">
      <header className="flex flex-col gap-3">
        <Link href={`/f/${token}`} className="text-ink-soft underline-offset-4 hover:underline">
          ← К книге
        </Link>
        <InterviewProgress
          current={current && phase !== "finished" ? { block: current.question.block, title: current.question.blockTitle.ru } : null}
          progress={current?.progress}
          kind={current?.kind ?? "question"}
          showLine={phase === "ask"}
        />
      </header>

      {saved && phase !== "loading" && <p className="rounded-card border border-success/40 bg-paper p-3 text-success">{saved}</p>}
      {message && <p className="rounded-card bg-paper-deep p-4 text-ink">{message}</p>}
      {error && <p className="rounded-card border border-danger/40 bg-paper p-4 text-danger">{error}</p>}

      {phase === "loading" && <p className="text-elder text-muted">Готовим вопрос…</p>}

      {phase === "waiting" && (
        <div className="flex flex-col gap-4 rounded-card bg-paper-deep p-5">
          <p className="text-elder">Слушаем ваш рассказ и готовим следующий вопрос…</p>
          <button
            type="button"
            onClick={() => {
              dontWait.current = true;
            }}
            className="rounded-button border border-line bg-paper px-4 py-3"
          >
            Дальше, не ждать
          </button>
        </div>
      )}

      {phase === "finished" && (
        <div className="flex flex-col gap-4">
          <p className="font-serif text-2xl">Спасибо, {storyteller.name}!</p>
          <Link href={`/f/${token}`} className="button flex items-center justify-center rounded-button bg-seal px-6 py-4 text-lg font-semibold text-paper">
            К книге
          </Link>
        </div>
      )}

      {phase === "ask" && current && (
        <>
          <section className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              {current.question.blockTitle.ru}
              {current.question.blockTitle.ko && <span lang="ko"> · {current.question.blockTitle.ko}</span>}
            </p>
            {current.bridge && <p className="text-ink-soft italic">{current.bridge}</p>}
            {current.pause && (
              <p className="rounded-card border border-jade/40 bg-paper p-3 text-ink-soft">
                Можно передохнуть. Если тема тяжёлая — нажмите «Вернуться позже».
              </p>
            )}
            <h1 className="font-serif text-elder leading-snug sm:text-kiosk">{current.prompt}</h1>
            {/* #233: корейская строка — только у семей с пакетом корё-сарам (у остальных банк отдаёт ko пустым) */}
            {current.kind === "question" && current.question.ko && (
              <p className="text-ink-soft" lang="ko">
                {current.question.ko}
              </p>
            )}
            {canSpeak() && (
              <button
                type="button"
                onClick={listen}
                disabled={recording}
                title={recording ? "Во время записи вопрос не озвучивается" : undefined}
                className={`self-start rounded-button px-5 py-3 disabled:opacity-50 ${
                  speechBlocked ? "bg-seal font-semibold text-paper" : "border border-line bg-paper"
                }`}
              >
                {speechBlocked ? "▶ Прослушать вопрос" : "🔊 Прослушать вопрос"}
              </button>
            )}
          </section>

          <Recorder key={take} onSend={onSend} sendLabel="Отправить рассказ" />

          <div className="mt-2 grid grid-cols-2 gap-3 border-t border-line pt-4">
            <button type="button" onClick={() => void skip("skip")} className="rounded-button border border-line px-4 py-3 text-ink-soft">
              Пропустить
            </button>
            <button type="button" onClick={() => void skip("later")} className="rounded-button border border-line px-4 py-3 text-ink-soft">
              Вернуться позже
            </button>
          </div>
        </>
      )}
    </main>
  );
}
