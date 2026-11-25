"use client";
// Сессия киоска: на ландшафтном планшете (lg) — две колонки без прокрутки, на телефоне и планшете стоя — одна
// колонка с прокруткой (#200): голосовое согласие (+ галочка «в архив АКНЦ») →
// вопросы крупно с озвучкой → запись → следующий вопрос. Запись и загрузка — общие компоненты I1
// (components/recorder) и те же ручки семьи (/api/upload-url, /api/consent, /api/stories) по токену семьи,
// который сервер отдаёт только вошедшему по PIN планшету. Интервью-агент I10 — /api/sessions с mode = 'kiosk'
// и volunteer_id; недоступен — идём по банку вопросов сами.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { QUESTIONS } from "@/content/questions/bank";
import { BLOCKS } from "@/content/questions/blocks";
import { postJson, Recorder, uploadAudio, type Take } from "@/components/recorder";
import type { LifeBlock } from "@/lib/types";
import { InterviewProgress } from "@/app/(family)/_ui/InterviewProgress";
import { localProgress, type InterviewProgressView } from "@/app/(family)/_ui/progress-line";
import { canSpeak, speak, stopSpeaking, useSpeechBlocked, useSpeechState } from "@/app/(family)/_ui/speak";
import { kDark, kGhost, kioskPost, kPrimary, kRecorderWrap } from "./ui";

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
  prompt: string;
  kind: "question" | "followup";
  bridge?: string;
  pause?: boolean;
  mainStoryId?: string | null;
  /** #101: прогресс от движка (вопрос N из M в разделе, уточнения) */
  progress?: InterviewProgressView;
}

type Phase = "consent" | "loading" | "ask" | "waiting" | "finished";

const POLL_TRIES = 6;
const POLL_MS = 2500;
const MAX_STEPS = 6;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function bankView(q: (typeof QUESTIONS)[number]): QuestionView {
  const b = BLOCKS.find((x) => x.id === q.block);
  return { id: q.id, block: q.block, blockTitle: { ru: b?.ru ?? q.block, ko: b?.ko ?? "" }, ru: q.ru, ko: q.ko };
}
const asQuestion = (q: QuestionView, extra: Partial<Current> = {}): Current => ({ question: q, prompt: q.ru, kind: "question", ...extra });

export interface KioskSessionProps {
  token: string;
  familyId: string;
  storyteller: { id: string; name: string; consented: boolean };
  archive: boolean;
  volunteerId: string | null;
  consentText: string;
  initialCovered: LifeBlock[];
  answeredQuestionIds: string[];
  familyUrl: string;
  familyQrSvg: string;
}

export function KioskSession(props: KioskSessionProps) {
  const { token, familyId, storyteller } = props;
  const storageKey = `ks:kiosk:${storyteller.id}`;

  const [phase, setPhase] = useState<Phase>(storyteller.consented ? "loading" : "consent");
  const [archive, setArchive] = useState(props.archive);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [current, setCurrent] = useState<Current | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [take, setTake] = useState(0);
  const recording = useSpeechBlocked(); // #100: идёт запись — «Озвучить» недоступна
  const [count, setCount] = useState(0);

  const session = useRef<string | null>(null);
  const local = useRef<{ done: Set<string>; later: string[] }>({ done: new Set(props.answeredQuestionIds), later: [] });
  const dontWait = useRef(false);
  const started = useRef(false);

  const persist = useCallback(
    (c: Current | null) => {
      try {
        if (session.current && c) localStorage.setItem(storageKey, JSON.stringify({ sessionId: session.current, current: c }));
        else localStorage.removeItem(storageKey);
      } catch {
        /* приватный режим — без восстановления */
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

  const nextLocal = useCallback(
    (msg?: string | null) => {
      const { done, later } = local.current;
      const q = QUESTIONS.find((x) => !done.has(x.id) && !later.includes(x.id)) ?? QUESTIONS.find((x) => later.includes(x.id) && !done.has(x.id));
      if (q) local.current.later = later.filter((id) => id !== q.id);
      show(q ? asQuestion(bankView(q), { progress: localProgress(QUESTIONS, done, q) }) : null, msg ?? (q ? null : "Все вопросы позади — спасибо огромное!"));
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
    (path: string, body: Record<string, unknown>) => postJson<AnswerResult>(`/api/sessions/${session.current}/${path}`, token, body),
    [token],
  );

  const startInterview = useCallback(async () => {
    setPhase("loading");
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
      /* начнём заново */
    }
    try {
      const res = await postJson<{ sessionId: string; question: QuestionView } & P>("/api/sessions", token, {
        familyId,
        storytellerId: storyteller.id,
        mode: "kiosk",
        volunteerId: props.volunteerId,
      });
      session.current = res.sessionId;
      let c = asQuestion(res.question, { progress: res.progress });
      // Повторный приход: пролистываем вопросы, на которые уже есть рассказы
      for (let i = 0; i < QUESTIONS.length && local.current.done.has(c.question.id); i++) {
        const r = await sessionCall("skip", { action: "skip" });
        if (r.type === "nextQuestion") c = asQuestion(r.question, { progress: r.progress });
        else if (r.type === "blockDone" && r.nextQuestion) c = asQuestion(r.nextQuestion, { progress: r.progress });
        else return apply(r, c);
      }
      show(c);
    } catch (e) {
      console.warn("[kiosk] интервью-агент недоступен, идём по банку:", e instanceof Error ? e.message : e);
      session.current = null;
      nextLocal();
    }
  }, [apply, familyId, nextLocal, props.volunteerId, sessionCall, show, storageKey, storyteller.id, token]);

  useEffect(() => {
    if (phase !== "loading" || started.current) return;
    started.current = true;
    const t = setTimeout(() => void startInterview(), 0);
    return () => clearTimeout(t);
  }, [phase, startInterview]);

  useEffect(() => () => stopSpeaking(), []);

  // #169: каждый новый вопрос озвучивается сам, один раз (ключ — текст). Не стартовал за ~1 с — «▶ Прослушать вопрос».
  const questionText = current && phase === "ask" ? [current.bridge, current.prompt].filter(Boolean).join(" ") : null;
  const speech = useSpeechState();
  const speechBlocked = Boolean(questionText) && speech.status === "blocked" && speech.text === questionText;
  useEffect(() => {
    if (questionText) speak(questionText, { auto: true });
  }, [questionText]);

  async function toggleArchive(next: boolean) {
    setArchive(next);
    setArchiveError(null);
    try {
      await kioskPost(`/api/kiosk/families/${familyId}/archive`, { consent: next });
    } catch (e) {
      setArchive(!next);
      setArchiveError(e instanceof Error ? e.message : "Не сохранилось. Нажмите ещё раз.");
    }
  }

  async function sendConsent(t: Take, onProgress: (p: number) => void) {
    const path = await uploadAudio({ token, storytellerId: storyteller.id, kind: "consent", take: t, onProgress });
    await postJson("/api/consent", token, { storytellerId: storyteller.id, path });
    setPhase("loading");
  }

  const drive = useCallback(
    async (storyId: string, from?: "edit") => {
      for (let i = 0; i < MAX_STEPS; i++) {
        try {
          const r = await postJson<{ next: string | null; queued: boolean; status: string }>(
            `/api/stories/${storyId}/process`,
            token,
            i === 0 && from ? { from } : {},
          );
          if (!r.next || r.queued || r.status === "failed") return;
        } catch (e) {
          console.warn("[kiosk] конвейер:", e instanceof Error ? e.message : e);
          return;
        }
      }
    },
    [token],
  );

  function rebuildIfFollowups(prev: Current, r: AnswerResult) {
    if (prev.kind === "followup" && prev.mainStoryId && r.type !== "followup") void drive(prev.mainStoryId, "edit");
  }

  const isGone = (e: unknown) => {
    const err = e as { status?: number; code?: string };
    return err.status === 404 || err.code === "finished";
  };

  function restart(prev: Current) {
    persist(null);
    session.current = null;
    local.current.done.add(prev.question.id);
    started.current = false;
    setPhase("loading");
  }

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
          rebuildIfFollowups(prev, r);
          return apply(r, prev);
        } catch (e) {
          if ((e as { code?: string }).code !== "not_ready") throw e;
          await sleep(POLL_MS);
        }
      }
      apply(await sessionCall("skip", { action: "skip", storyId }), prev); // расшифровки нет — рассказ засчитан ответом (#107), идём дальше
    } catch (e) {
      if (isGone(e)) return restart(prev);
      console.warn("[kiosk] агент не ответил, идём по банку:", e instanceof Error ? e.message : e);
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
    if (prev.kind === "question") setCount((n) => n + 1);
    setSaved(prev.kind === "followup" ? "Дополнение сохранено ✓" : "Рассказ сохранён ✓");
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
      rebuildIfFollowups(prev, r);
      apply(r, prev);
    } catch (e) {
      if (isGone(e)) return restart(prev);
      setError("Не получилось перейти к другому вопросу. Попробуйте ещё раз.");
      setPhase("ask");
    }
  }

  function listen() {
    if (!current || recording) return;
    speak([current.bridge, current.prompt].filter(Boolean).join(" "));
  }

  function finish() {
    stopSpeaking();
    persist(null);
    setCurrent(null);
    setMessage(null);
    setPhase("finished");
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-7xl flex-col gap-5 px-5 py-4 sm:px-8 lg:h-dvh lg:overflow-hidden lg:py-5">
      <header className="flex shrink-0 flex-wrap items-center gap-4 sm:gap-6">
        <div className="min-w-0 flex-1 basis-52">
          <p className="font-serif text-2xl break-words sm:text-3xl lg:truncate">{storyteller.name}</p>
          <p className="text-muted">{phase === "consent" ? "Шаг 1 · согласие" : `Записано рассказов сегодня: ${count}`}</p>
        </div>
        {phase !== "finished" ? (
          <button type="button" onClick={finish} className={kGhost}>
            Завершить
          </button>
        ) : (
          <Link href="/kiosk/queue" className={kGhost}>
            Очередь дня
          </Link>
        )}
      </header>

      {phase === "ask" && current && (
        <div className="shrink-0">
          <InterviewProgress
            current={{ block: current.question.block, title: current.question.blockTitle.ru }}
            progress={current.progress}
            kind={current.kind}
            large
          />
        </div>
      )}

      {phase === "consent" && (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 lg:grid-cols-[1.15fr_1fr] lg:gap-8">
          <section className="flex min-h-0 flex-col gap-4">
            <h1 className="font-serif text-3xl leading-tight sm:text-4xl">Согласие на запись</h1>
            <p className="text-elder text-ink-soft">Попросите прочитать вслух или повторить за вами:</p>
            <blockquote className="rounded-card border-l-4 border-seal bg-paper-deep p-5 text-kiosk text-ink sm:p-6 lg:min-h-0 lg:overflow-y-auto">{props.consentText}</blockquote>
          </section>
          <section className="flex min-h-0 flex-col justify-center gap-6">
            <div className={kRecorderWrap}>
              <Recorder maxSec={120} startLabel="Записать согласие" sendLabel="Сохранить согласие" onSend={sendConsent} allowFile={false} />
            </div>
            <label className="flex min-h-16 cursor-pointer items-center gap-4 rounded-card border border-line bg-paper p-5 text-elder">
              <input type="checkbox" checked={archive} onChange={(e) => void toggleArchive(e.target.checked)} className="size-8 shrink-0 accent-jade" />
              <span>
                Семья согласна передать записи в архив АКНЦ
                <span className="block text-base text-muted">Отдельная галочка, по желанию. Можно изменить позже.</span>
              </span>
            </label>
            {archiveError && <p className="text-danger">{archiveError}</p>}
          </section>
        </div>
      )}

      {(phase === "loading" || phase === "waiting") && (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 text-center">
          {saved && phase === "waiting" && <p className="text-kiosk text-success">{saved}</p>}
          <p className="text-kiosk text-muted">{phase === "waiting" ? "Слушаем рассказ и готовим следующий вопрос…" : "Готовим вопрос…"}</p>
          {phase === "waiting" && (
            <button type="button" onClick={() => (dontWait.current = true)} className={kGhost}>
              Дальше, не ждать
            </button>
          )}
        </div>
      )}

      {phase === "ask" && current && (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 lg:grid-cols-[1.25fr_1fr] lg:grid-rows-[1fr_auto] lg:gap-x-8 lg:gap-y-4">
          <section className="flex min-h-0 flex-col gap-4 lg:col-start-1 lg:row-start-1">
            <p className="text-elder text-muted">
              {current.question.blockTitle.ru}
              {current.question.blockTitle.ko && <span lang="ko"> · {current.question.blockTitle.ko}</span>}
            </p>
            {(message || current.bridge) && <p className="text-elder text-ink-soft italic">{message ?? current.bridge}</p>}
            <h1 className="font-serif text-kiosk leading-snug break-words lg:text-4xl lg:leading-snug">{current.prompt}</h1>
            {current.kind === "question" && (
              <p className="text-elder text-ink-soft" lang="ko">
                {current.question.ko}
              </p>
            )}
            {current.pause && <p className="text-elder text-jade">Можно передохнуть. Тема тяжёлая — нажмите «Вернуться позже».</p>}
            {error && <p className="text-elder text-danger">{error}</p>}
          </section>
          <section className={`flex min-h-0 flex-col justify-center lg:col-start-2 lg:row-span-2 lg:row-start-1 ${kRecorderWrap}`}>
            <Recorder key={take} onSend={onSend} sendLabel="Сохранить рассказ" allowFile={false} />
          </section>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:col-start-1 lg:row-start-2">
            {canSpeak() && (
              <button
                type="button"
                onClick={listen}
                disabled={recording}
                className={`${speechBlocked ? kPrimary : kGhost} disabled:opacity-50`}
              >
                {speechBlocked ? "▶ Прослушать" : "🔊 Озвучить"}
              </button>
            )}
            <button type="button" onClick={() => void skip("skip")} className={kGhost}>
              Пропустить
            </button>
            <button type="button" onClick={() => void skip("later")} className={kGhost}>
              Вернуться позже
            </button>
          </div>
        </div>
      )}

      {phase === "finished" && (
        <div className="grid min-h-0 flex-1 grid-cols-1 items-center gap-8 lg:grid-cols-[1fr_auto] lg:gap-10">
          <section className="flex flex-col gap-5">
            <h1 className="font-serif text-4xl leading-tight break-words sm:text-5xl">Спасибо, {storyteller.name}!</h1>
            {message && <p className="text-kiosk text-ink-soft">{message}</p>}
            <p className="text-elder text-ink-soft">
              Главы появятся в книге через несколько минут. Пусть родные наведут камеру телефона на код — откроется книга семьи, туда можно
              дописывать рассказы из дома.
            </p>
            <div className="flex flex-col gap-4 sm:flex-row">
              <Link href="/kiosk/new" className={kPrimary}>
                Следующий старейшина
              </Link>
              <button
                type="button"
                onClick={() => {
                  started.current = false;
                  setPhase("loading");
                }}
                className={kDark}
              >
                Ещё вопрос
              </button>
            </div>
          </section>
          <a
            href={props.familyUrl}
            target="_blank"
            rel="noreferrer"
            className="mx-auto block w-full max-w-72 rounded-card bg-paper p-2 text-ink shadow-card [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
            aria-label="Ссылка на книгу семьи"
            dangerouslySetInnerHTML={{ __html: props.familyQrSvg }}
          />
        </div>
      )}
    </main>
  );
}
