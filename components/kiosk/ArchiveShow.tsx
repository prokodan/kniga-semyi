"use client";
// #200: «▶ Показ» — главы архива АКНЦ по очереди на весь экран (зал центра, телевизор, планшет на стойке).
// Сам листает раз в SLIDE_MS; ← → / пробел — вручную. Без меню киоска, без ссылок на книгу семьи и без голоса.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ShowChapter } from "@/app/api/kiosk/_lib/archive";
import { kGhost } from "./ui";

export type Slide = ShowChapter & { storyteller: string; storytellerKo: string | null; meta: string };

const SLIDE_MS = 25_000;
const ctl = `${kGhost} min-h-12 px-4 text-base sm:min-h-14 sm:text-elder`;

export function ArchiveShow({ slides, start }: { slides: Slide[]; start: number }) {
  const [i, setI] = useState(Math.min(start, Math.max(0, slides.length - 1)));
  const [playing, setPlaying] = useState(true);
  const [tick, setTick] = useState(0); // ручное листание — таймер заново
  const total = slides.length;

  const go = useCallback(
    (d: number) => {
      if (total === 0) return;
      setI((x) => (x + d + total) % total);
      setTick((t) => t + 1);
    },
    [total],
  );

  useEffect(() => {
    if (!playing || total < 2) return;
    const t = setTimeout(() => setI((x) => (x + 1) % total), SLIDE_MS);
    return () => clearTimeout(t);
  }, [i, playing, tick, total]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  function fullscreen() {
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    else if (el.requestFullscreen) void el.requestFullscreen().catch(() => undefined);
    else el.webkitRequestFullscreen?.();
  }

  const s = slides[i];
  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-paper">
      {!s ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
          <p className="font-serif text-4xl">В архиве пока нет глав</p>
          <Link href="/kiosk/archive" className={kGhost}>
            ← Архив
          </Link>
        </div>
      ) : (
        <article key={s.id} aria-live="polite" className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-4 overflow-y-auto px-5 pt-6 pb-4 sm:px-10 sm:pt-10">
          <p className="text-muted">
            АКНЦ · <span lang="ko">알마티 고려인 센터</span> · {s.section} · <span lang="ko">{s.sectionKo}</span>
          </p>
          <div>
            <p className="font-serif text-2xl break-words text-ink-soft sm:text-3xl">
              {s.storyteller}
              {s.storytellerKo && <span lang="ko"> · {s.storytellerKo}</span>}
            </p>
            {s.meta && <p className="text-muted">{s.meta}</p>}
          </div>
          <h1 className="font-serif text-4xl leading-tight break-words sm:text-5xl">{s.title}</h1>
          {s.titleKo && (
            <p className="-mt-2 font-serif text-2xl break-words text-ink-soft sm:text-3xl" lang="ko">
              {s.titleKo}
            </p>
          )}
          {s.quote && (
            <blockquote className="rounded-card border-l-4 border-seal bg-paper-deep p-5 text-kiosk break-words">
              «{s.quote}»
              {s.quoteKo && (
                <span className="mt-2 block text-elder text-ink-soft" lang="ko">
                  “{s.quoteKo}”
                </span>
              )}
            </blockquote>
          )}
          <div className="grid gap-6 text-elder lg:grid-cols-2">
            <div className="break-words whitespace-pre-line">{s.textRu}</div>
            {s.textKo && (
              <div className="break-words whitespace-pre-line text-ink-soft" lang="ko">
                {s.textKo}
              </div>
            )}
          </div>
        </article>
      )}

      <nav aria-label="Управление показом" className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-paper-deep px-3 py-2 sm:gap-3 sm:px-6">
        <button type="button" onClick={() => go(-1)} className={ctl} disabled={total < 2} aria-label="Предыдущая глава">
          ←
        </button>
        <button type="button" onClick={() => setPlaying((p) => !p)} className={ctl} disabled={total < 2}>
          {playing ? "⏸ Пауза" : "▶ Дальше сам"}
        </button>
        <button type="button" onClick={() => go(1)} className={ctl} disabled={total < 2} aria-label="Следующая глава">
          →
        </button>
        <span className="min-w-12 flex-1 text-center text-muted">{total ? `${i + 1} из ${total}` : ""}</span>
        {/* iPhone Safari не умеет «весь экран» для страницы — на телефоне кнопки нет */}
        <span className="hidden sm:contents">
          <button type="button" onClick={fullscreen} className={ctl}>
            ⛶ Весь экран
          </button>
        </span>
        <Link href="/kiosk/archive" className={ctl}>
          ✕ Выйти
        </Link>
      </nav>
    </main>
  );
}
