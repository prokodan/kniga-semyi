"use client";
import { useEffect, useRef, useState } from "react";

// Плеер голоса: одна большая кнопка ▶ / ❚❚, полоса прогресса, время. Без библиотек.
// preload="metadata" — страница открывается мгновенно, звук начинает грузиться по нажатию.
function fmt(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}

export function VoicePlayer({ src, durationHint }: { src: string; durationHint?: number | null }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(durationHint ?? 0);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    const on = (ev: string, fn: () => void) => (a.addEventListener(ev, fn), () => a.removeEventListener(ev, fn));
    const offs = [
      on("timeupdate", () => setTime(a.currentTime)),
      on("loadedmetadata", () => Number.isFinite(a.duration) && a.duration > 0 && setDuration(a.duration)),
      on("durationchange", () => Number.isFinite(a.duration) && a.duration > 0 && setDuration(a.duration)),
      on("play", () => setPlaying(true)),
      on("playing", () => setLoading(false)),
      on("waiting", () => setLoading(true)),
      on("pause", () => setPlaying(false)),
      on("ended", () => (setPlaying(false), setTime(0))),
      on("error", () => (setFailed(true), setLoading(false))),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  async function toggle() {
    const a = audio.current;
    if (!a) return;
    if (!a.paused) return a.pause();
    setLoading(true);
    try {
      await a.play();
    } catch {
      setLoading(false);
    }
  }

  function seek(e: React.ChangeEvent<HTMLInputElement>) {
    const a = audio.current;
    if (a && duration) a.currentTime = (Number(e.target.value) / 1000) * duration;
  }

  const progress = duration ? Math.min(1000, Math.round((time / duration) * 1000)) : 0;

  if (failed) {
    return (
      <div className="flex flex-col items-center gap-2 text-center">
        <p className="text-ink-soft">Телефон не смог воспроизвести запись здесь.</p>
        <a href={src} className="inline-flex min-h-12 items-center text-seal underline underline-offset-4">
          Открыть запись отдельно
        </a>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-4">
      <audio ref={audio} src={src} preload="metadata" playsInline />
      <button
        type="button"
        onClick={() => void toggle()}
        aria-label={playing ? "Пауза" : "Слушать голос"}
        className="flex size-24 items-center justify-center rounded-full bg-seal text-paper shadow-card transition-transform active:scale-95 active:bg-seal-dark"
      >
        {playing ? (
          <svg viewBox="0 0 24 24" className="size-10" fill="currentColor" aria-hidden>
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className={`ml-1 size-11 ${loading ? "animate-pulse" : ""}`} fill="currentColor" aria-hidden>
            <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" />
          </svg>
        )}
      </button>
      <div className="flex w-full items-center gap-3 text-sm text-muted tabular-nums">
        <span className="w-10 text-right">{fmt(time)}</span>
        <input
          type="range"
          min={0}
          max={1000}
          value={progress}
          onChange={seek}
          aria-label="Перемотка"
          className="h-12 flex-1 accent-seal"
          disabled={!duration}
        />
        <span className="w-10">{fmt(duration)}</span>
      </div>
      {!playing && time === 0 && <p className="text-ink-soft">Нажмите, чтобы услышать живой голос</p>}
    </div>
  );
}
