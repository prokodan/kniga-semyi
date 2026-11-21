"use client";
// Кнопка записи с таймером, паузой, прослушиванием и запасным путём «загрузить файл».
import { useRef, useState } from "react";
import { formatTime } from "./mime";
import { fileDuration } from "./upload";
import { useRecorder, type Take } from "./useRecorder";

const MAX_FILE_BYTES = 50 * 1024 * 1024;

export interface RecorderProps {
  /** Лимит записи, секунд (по умолчанию 5 минут) */
  maxSec?: number;
  /** Отправить дубль. Бросить ошибку — дубль останется, можно повторить. */
  onSend: (take: Take, onProgress: (p: number) => void) => Promise<void>;
  sendLabel?: string;
  startLabel?: string;
  /** Показывать «загрузить файл» */
  allowFile?: boolean;
}

export function Recorder({ maxSec = 300, onSend, sendLabel = "Отправить", startLabel = "Начать запись", allowFile = true }: RecorderProps) {
  const r = useRecorder({ maxSec });
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [sendError, setSendError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function send() {
    if (!r.take || sending) return;
    setSending(true);
    setSendError(null);
    setProgress(0);
    try {
      await onSend(r.take, setProgress);
      r.reset();
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Не получилось отправить. Попробуйте ещё раз.");
    } finally {
      setSending(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const type = file.type || (/\.m4a$/i.test(file.name) ? "audio/mp4" : "");
    if (!type.startsWith("audio/") && !type.startsWith("video/")) {
      r.setError("Это не похоже на аудиозапись. Выберите файл из диктофона (m4a, mp3, ogg, wav).");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      r.setError("Файл больше 50 МБ. Выберите запись покороче.");
      return;
    }
    const url = URL.createObjectURL(file);
    const durationSec = await fileDuration(url);
    r.loadFile({ blob: file, url, mime: type, durationSec, source: "file" });
  }

  const recording = r.state === "recording";
  const paused = r.state === "paused";
  const left = Math.max(0, maxSec - r.elapsed);

  return (
    <div className="flex flex-col gap-4">
      {(r.state === "idle" || r.state === "error" || r.state === "requesting") && (
        <button
          type="button"
          onClick={() => void r.start()}
          disabled={r.state === "requesting"}
          className="flex items-center justify-center gap-3 rounded-button bg-seal px-6 py-5 text-elder font-semibold text-paper shadow-card active:bg-seal-dark disabled:opacity-60"
        >
          <span aria-hidden className="inline-block size-4 rounded-full bg-paper" />
          {r.state === "requesting" ? "Включаем микрофон…" : startLabel}
        </button>
      )}

      {(recording || paused) && (
        <div className="flex flex-col items-center gap-4 rounded-card bg-paper-deep p-5 shadow-card">
          <div className="flex items-center gap-3" aria-live="polite">
            <span aria-hidden className={`inline-block size-4 rounded-full ${recording ? "animate-pulse bg-seal" : "bg-muted"}`} />
            <span className="font-serif text-4xl tabular-nums">{formatTime(r.elapsed)}</span>
            <span className="text-muted">/ {formatTime(maxSec)}</span>
          </div>
          <p className="text-sm text-muted">
            {recording ? (left <= 30 ? `Осталось ${Math.ceil(left)} секунд` : "Идёт запись — говорите спокойно, не торопитесь") : "Пауза"}
          </p>
          <div className="grid w-full grid-cols-2 gap-3">
            {recording ? (
              <button type="button" onClick={r.pause} className="rounded-button border border-line bg-paper px-4 py-3 text-lg">
                Пауза
              </button>
            ) : (
              <button type="button" onClick={r.resume} className="rounded-button border border-line bg-paper px-4 py-3 text-lg">
                Продолжить
              </button>
            )}
            <button type="button" onClick={r.stop} className="rounded-button bg-ink px-4 py-3 text-lg text-paper">
              Готово
            </button>
          </div>
        </div>
      )}

      {r.state === "stopped" && r.take && (
        <div className="flex flex-col gap-3 rounded-card bg-paper-deep p-5 shadow-card">
          <p className="text-ink-soft">
            {r.take.source === "file" ? "Файл выбран" : "Запись готова"}
            {r.take.durationSec > 0 ? ` · ${formatTime(r.take.durationSec)}` : ""}. Прослушайте перед отправкой:
          </p>
          <audio controls src={r.take.url} className="w-full" preload="metadata" />
          {sending && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
              <div className="h-full bg-jade transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending}
            className="rounded-button bg-seal px-6 py-4 text-elder font-semibold text-paper active:bg-seal-dark disabled:opacity-60"
          >
            {sending ? `Отправляем… ${Math.round(progress * 100)}%` : sendLabel}
          </button>
          <button type="button" onClick={r.reset} disabled={sending} className="rounded-button border border-line px-4 py-3 text-ink-soft">
            Записать заново
          </button>
        </div>
      )}

      {r.notice && <p className="rounded-card border border-warning/40 bg-paper p-4 text-ink">{r.notice}</p>}
      {(r.error || sendError) && <p className="rounded-card border border-danger/40 bg-paper p-4 text-danger">{sendError ?? r.error}</p>}

      {allowFile && !recording && !paused && !sending && (
        <>
          <button type="button" onClick={() => fileInput.current?.click()} className="text-center text-ink-soft underline underline-offset-4">
            или загрузить запись из диктофона
          </button>
          <input ref={fileInput} type="file" accept="audio/*,.m4a,.mp3,.ogg,.opus,.wav,.aac" className="hidden" onChange={(e) => void onFile(e)} />
        </>
      )}
    </div>
  );
}
