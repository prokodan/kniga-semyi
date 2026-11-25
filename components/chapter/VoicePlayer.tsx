"use client";
import { useEffect, useRef, useState } from "react";

// Плеер голоса: одна большая кнопка ▶ / ❚❚, полоса прогресса, время. Без библиотек.
// Глава — несколько записей (основной ответ + ответы на уточнения): играем подряд в одном <audio>,
// время и перемотка — по всей главе. preload="metadata" — страница открывается мгновенно.
function fmt(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}

export interface VoicePart {
  src: string;
  durationSec: number | null;
}

/** Часть и смещение для позиции `t` (с) по всей главе. */
export function locate(durations: number[], t: number): { index: number; offset: number } {
  let acc = 0;
  for (let i = 0; i < durations.length; i++) {
    const d = durations[i] ?? 0;
    if (t < acc + d || i === durations.length - 1) return { index: i, offset: Math.max(0, Math.min(t - acc, d || t - acc)) };
    acc += d;
  }
  return { index: 0, offset: 0 };
}

export function VoicePlayer({ parts }: { parts: VoicePart[] }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0); // внутри текущей части
  const [durations, setDurations] = useState<number[]>(() => parts.map((p) => p.durationSec ?? 0));
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const want = useRef<{ offset: number; play: boolean } | null>(null);
  const idx = useRef(0);
  useEffect(() => {
    idx.current = index;
  }, [index]);

  const before = durations.slice(0, index).reduce((a, b) => a + b, 0);
  const total = durations.reduce((a, b) => a + b, 0);
  const global = before + time;

  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    const on = (ev: string, fn: () => void) => (a.addEventListener(ev, fn), () => a.removeEventListener(ev, fn));
    const setDur = () => {
      if (!Number.isFinite(a.duration) || a.duration <= 0) return;
      setDurations((d) => (Math.abs((d[idx.current] ?? 0) - a.duration) < 0.3 ? d : d.map((x, i) => (i === idx.current ? a.duration : x))));
    };
    const offs = [
      on("timeupdate", () => setTime(a.currentTime)),
      on("loadedmetadata", () => {
        setDur();
        const w = want.current;
        if (w) {
          want.current = null;
          if (w.offset > 0) a.currentTime = w.offset;
          if (w.play) void a.play().catch(() => setLoading(false));
        }
      }),
      on("durationchange", setDur),
      on("play", () => setPlaying(true)),
      on("playing", () => setLoading(false)),
      on("waiting", () => setLoading(true)),
      on("pause", () => setPlaying(false)),
      on("ended", () => {
        if (idx.current < parts.length - 1) {
          // следующая запись главы — без паузы
          want.current = { offset: 0, play: true };
          setTime(0);
          idx.current += 1;
          setIndex(idx.current);
        } else {
          setPlaying(false);
          setTime(0);
          if (idx.current !== 0) want.current = { offset: 0, play: false };
          idx.current = 0;
          setIndex(0);
        }
      }),
      on("error", () => (setFailed(true), setLoading(false))),
    ];
    return () => offs.forEach((off) => off());
  }, [parts.length]);

  // Сменилась часть: новый src браузер грузит сам, play и перемотка — по loadedmetadata (want)
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
    if (!a || !total) return;
    const { index: i, offset } = locate(durations, (Number(e.target.value) / 1000) * total);
    if (i === index) {
      a.currentTime = offset;
      return;
    }
    want.current = { offset, play: !a.paused };
    setTime(offset);
    idx.current = i;
    setIndex(i);
  }

  const progress = total ? Math.min(1000, Math.round((global / total) * 1000)) : 0;
  const src = parts[index]?.src ?? parts[0]!.src;

  if (failed) {
    return (
      <div className="flex flex-col items-center gap-2 text-center">
        <p className="text-ink-soft">Телефон не смог воспроизвести запись здесь.</p>
        <a href={parts[0]!.src} className="inline-flex min-h-12 items-center text-seal underline underline-offset-4">
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
        <span className="w-10 text-right">{fmt(global)}</span>
        <input
          type="range"
          min={0}
          max={1000}
          value={progress}
          onChange={seek}
          aria-label="Перемотка"
          className="h-12 flex-1 accent-seal"
          disabled={!total}
        />
        <span className="w-10">{fmt(total)}</span>
      </div>
      {!playing && global === 0 && <p className="text-ink-soft">Нажмите, чтобы услышать живой голос</p>}
      {parts.length > 1 && (
        <p className="text-sm text-muted">
          Запись {index + 1} из {parts.length}: рассказ и ответы на уточнения
        </p>
      )}
    </div>
  );
}
