"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { STORY_PIPELINE, type StoryStatus } from "@/lib/types";

// Экран ожидания главы: опрашивает GET /api/stories/:id (токен семьи) и обновляет страницу, когда глава готова.
// Если конвейер стоит (семья закрыла запись на середине) — сам двигает его: POST /process, один шаг за вызов.
const STEPS: { status: StoryStatus; label: string }[] = [
  { status: "uploaded", label: "Запись получена" },
  { status: "transcribing", label: "Слушаем и записываем" },
  { status: "editing", label: "Собираем главу" },
  { status: "translating", label: "Переводим на корейский" },
];
const POLL_MS = 3000;
const STALL_MS = 20000;

interface View {
  status: StoryStatus;
  done: boolean;
  message: string;
  error: string | null;
  updatedAt: string;
}

export function StoryWaiting({ storyId, token, initial }: { storyId: string; token: string; initial: View }) {
  const router = useRouter();
  const [view, setView] = useState<View>(initial);
  const [busy, setBusy] = useState(false);
  const last = useRef({ updatedAt: initial.updatedAt, since: 0, kicking: false });

  async function kick() {
    if (last.current.kicking) return;
    last.current.kicking = true;
    setBusy(true);
    try {
      await fetch(`/api/stories/${storyId}/process`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-family-token": token },
        body: "{}",
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
    async function tick() {
      try {
        const res = await fetch(`/api/stories/${storyId}?token=${encodeURIComponent(token)}`, { cache: "no-store" });
        if (res.ok) {
          const v = (await res.json()) as View;
          if (stop) return;
          setView(v);
          if (v.done) return router.refresh();
          if (v.updatedAt !== last.current.updatedAt) last.current = { ...last.current, updatedAt: v.updatedAt, since: Date.now() };
          else if (v.status !== "failed" && Date.now() - last.current.since > STALL_MS) void kick();
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
          {STEPS.map((s, i) => {
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
      {failed && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void kick().then(() => setView((v) => ({ ...v, status: "uploaded", message: "Пробуем ещё раз…" })))}
          className="button rounded-button bg-seal px-6 py-4 text-lg font-semibold text-paper disabled:opacity-60"
        >
          {busy ? "Запускаем…" : "Собрать главу ещё раз"}
        </button>
      )}
      <p className="text-sm text-muted">Обычно это 1–3 минуты. Если закрыть страницу, сборка продолжится, когда вы откроете главу снова.</p>
    </section>
  );
}
