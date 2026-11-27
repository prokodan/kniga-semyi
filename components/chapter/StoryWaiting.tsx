"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { translatingStep } from "@/lib/pipeline/langs";
import { STORY_PIPELINE, type BookLang, type StoryStatus } from "@/lib/types";

// Экран ожидания главы: опрашивает GET /api/stories/:id (токен семьи) и обновляет страницу, когда глава готова.
// Конвейер двигает сервер (цепочка в /process + kick-stuck раз в 10 мин); экран — подстраховка: стоит 20 с → POST /process.
// Стоит дольше 45 с или failed — кнопка «Перезапустить сборку»: продолжает с застрявшего шага (restart: true).
// #293: шаг перевода — по языкам книги («на корейский» / «на казахский»), книга только RU — без шага перевода.
// Языки не переданы — как раньше (RU + KR).
function steps(langs?: readonly BookLang[]): { status: StoryStatus; label: string }[] {
  const translating = langs ? translatingStep(langs) : "Переводим на корейский";
  return [
    { status: "uploaded", label: "Запись получена" },
    { status: "transcribing", label: "Слушаем и записываем" },
    { status: "editing", label: "Собираем главу" },
    ...(translating ? [{ status: "translating" as const, label: translating }] : []),
  ];
}
const POLL_MS = 3000;
const STALL_MS = 20000;
const SHOW_RESTART_MS = 45000;

interface View {
  status: StoryStatus;
  done: boolean;
  message: string;
  error: string | null;
  updatedAt: string;
}

export function StoryWaiting({ storyId, token, initial, langs }: { storyId: string; token: string; initial: View; langs?: readonly BookLang[] }) {
  const router = useRouter();
  const [view, setView] = useState<View>(initial);
  const [busy, setBusy] = useState(false);
  const [stalled, setStalled] = useState(false);
  const last = useRef({ updatedAt: initial.updatedAt, since: 0, changed: 0, kicking: false });

  async function kick(restart = false) {
    if (last.current.kicking) return;
    last.current.kicking = true;
    setBusy(true);
    try {
      await fetch(`/api/stories/${storyId}/process`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-family-token": token },
        body: JSON.stringify(restart ? { restart: true } : {}),
      });
    } catch {
      /* сеть — повторим на следующем круге */
    } finally {
      last.current.kicking = false;
      last.current.since = Date.now();
      setBusy(false);
    }
  }

  useEffect(() => {
    let stop = false;
    last.current.since = Date.now();
    last.current.changed = Date.now();
    async function tick() {
      try {
        const res = await fetch(`/api/stories/${storyId}?token=${encodeURIComponent(token)}`, { cache: "no-store" });
        if (res.ok) {
          const v = (await res.json()) as View;
          if (stop) return;
          setView(v);
          if (v.done) return router.refresh();
          if (v.updatedAt !== last.current.updatedAt) {
            last.current = { ...last.current, updatedAt: v.updatedAt, since: Date.now(), changed: Date.now() };
            setStalled(false);
          } else {
            if (v.status !== "failed" && Date.now() - last.current.since > STALL_MS) void kick();
            if (Date.now() - last.current.changed > SHOW_RESTART_MS) setStalled(true);
          }
        }
      } catch {
        /* нет сети — ждём */
      }
      if (!stop) setTimeout(tick, POLL_MS);
    }
    const t = setTimeout(tick, POLL_MS);
    return () => {
      stop = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- один цикл опроса на страницу
  }, [storyId, token]);

  const current = STORY_PIPELINE.indexOf(view.status);
  const failed = view.status === "failed";

  return (
    <section className="flex flex-col gap-5 rounded-card bg-paper-deep p-6 shadow-card" aria-live="polite">
      <h2 className="font-serif text-2xl">{failed ? "Глава пока не собралась" : "Глава готовится"}</h2>
      <p className="text-elder text-ink-soft">{failed ? "Запись сохранена — ничего не потерялось. Попробуем ещё раз?" : view.message}</p>
      {!failed && (
        <ol className="flex flex-col gap-3">
          {steps(langs).map((s, i) => {
            const state = i < current ? "done" : i === current ? "now" : "later";
            return (
              <li key={s.status} className={`flex items-center gap-3 ${state === "later" ? "text-muted" : "text-ink"}`}>
                <span
                  aria-hidden
                  className={`flex size-7 shrink-0 items-center justify-center rounded-full text-sm ${
                    state === "done" ? "bg-jade text-paper" : state === "now" ? "animate-pulse bg-seal text-paper" : "bg-line"
                  }`}
                >
                  {state === "done" ? "✓" : i + 1}
                </span>
                {s.label}
              </li>
            );
          })}
        </ol>
      )}
      {failed && view.error && <p className="text-sm text-muted">{view.error}</p>}
      {(failed || stalled) && (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void kick(true).then(() => {
              last.current.changed = Date.now();
              setStalled(false);
              setView((v) => ({ ...v, status: v.status === "failed" ? "uploaded" : v.status, message: "Пробуем ещё раз…" }));
            })
          }
          className="button rounded-button bg-seal px-6 py-4 text-lg font-semibold text-paper disabled:opacity-60"
        >
          {busy ? "Запускаем…" : "Перезапустить сборку"}
        </button>
      )}
      <p className="text-sm text-muted">Обычно это 1–3 минуты. Страницу можно закрыть — глава соберётся сама.</p>
    </section>
  );
}
