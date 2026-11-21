"use client";
// Запись голоса через MediaRecorder. Главное правило: ничего не терять молча.
// - данные копятся кусками раз в секунду (start(1000)) — при обрыве есть всё до последней секунды;
// - экран гаснет / вкладка сворачивается / пришёл звонок → ставим на паузу и честно говорим об этом;
// - iOS отобрал микрофон (track ended) → завершаем запись с тем, что успели, и предлагаем прослушать;
// - Wake Lock держит экран включённым во время записи (iOS 16.4+, Android Chrome).
import { useCallback, useEffect, useRef, useState } from "react";
import { blobType, browserMime, isAppleWebKit } from "./mime";

export type RecorderState = "idle" | "requesting" | "recording" | "paused" | "stopped" | "error";

export interface Take {
  blob: Blob;
  url: string;
  mime: string;
  durationSec: number;
  source: "mic" | "file";
}

type WakeLockSentinelLike = { release: () => Promise<void> };

export function useRecorder({ maxSec = 300 }: { maxSec?: number } = {}) {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [take, setTake] = useState<Take | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const acc = useRef(0); // накопленные мс записи без пауз
  const segStart = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const wake = useRef<WakeLockSentinelLike | null>(null);
  const stopReason = useRef<"user" | "limit" | "interrupted">("user");

  const now = () => performance.now();

  const releaseWake = useCallback(() => {
    wake.current?.release().catch(() => undefined);
    wake.current = null;
  }, []);

  const requestWake = useCallback(async () => {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinelLike> } };
      if (nav.wakeLock && document.visibilityState === "visible") wake.current = await nav.wakeLock.request("screen");
    } catch {
      // нет разрешения или не поддерживается — работаем без него, пауза при блокировке всё равно сработает
    }
  }, []);

  const cleanup = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    releaseWake();
  }, [releaseWake]);

  const stop = useCallback((reason: "user" | "limit" | "interrupted" = "user") => {
    const r = rec.current;
    if (!r || r.state === "inactive") return;
    stopReason.current = reason;
    if (segStart.current != null) {
      acc.current += now() - segStart.current;
      segStart.current = null;
    }
    try {
      r.stop(); // onstop соберёт блоб
    } catch {
      // уже остановлен системой — onstop всё равно придёт или уже пришёл
    }
  }, []);

  const pause = useCallback((why?: string) => {
    const r = rec.current;
    if (!r || r.state !== "recording") return;
    try {
      r.pause();
      r.requestData(); // сбросить буфер: данные не должны жить только внутри рекордера
    } catch {
      /* ignore */
    }
    if (segStart.current != null) {
      acc.current += now() - segStart.current;
      segStart.current = null;
    }
    setElapsed(acc.current / 1000);
    setState("paused");
    releaseWake();
    if (why) setNotice(why);
  }, [releaseWake]);

  const resume = useCallback(() => {
    const r = rec.current;
    const track = stream.current?.getAudioTracks()[0];
    if (!r || r.state !== "paused") return;
    if (!track || track.readyState === "ended") {
      // iOS забрал микрофон, пока экран был выключен — дописать нельзя, отдаём то, что есть
      setNotice("Телефон отключил микрофон, пока экран был выключен. Мы сохранили то, что успели записать — прослушайте и отправьте.");
      stop("interrupted");
      return;
    }
    r.resume();
    segStart.current = now();
    setState("recording");
    setNotice(null);
    void requestWake();
  }, [requestWake, stop]);

  const start = useCallback(async () => {
    setError(null);
    setNotice(null);
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Этот браузер не умеет записывать звук. Загрузите запись из диктофона кнопкой ниже.");
      setState("error");
      return;
    }
    setState("requesting");
    let s: MediaStream;
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      setError(
        name === "NotAllowedError"
          ? "Нет доступа к микрофону. Разрешите его в настройках браузера (Safari: «аА» в адресной строке → Настройки веб-сайта → Микрофон) и нажмите ещё раз."
          : "Не получилось включить микрофон. Попробуйте ещё раз или загрузите запись файлом.",
      );
      setState("error");
      return;
    }
    stream.current = s;
    const apple = isAppleWebKit(navigator.userAgent, navigator.maxTouchPoints);
    const mime = browserMime();
    let r: MediaRecorder;
    try {
      r = new MediaRecorder(s, mime ? { mimeType: mime, audioBitsPerSecond: 64_000 } : undefined);
    } catch {
      r = new MediaRecorder(s); // формат не принят — пусть браузер выберет сам
    }
    rec.current = r;
    chunks.current = [];
    acc.current = 0;
    stopReason.current = "user";

    r.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.current.push(e.data);
    };
    r.onerror = () => {
      setNotice("Запись прервалась. Мы сохранили то, что успели — прослушайте и отправьте или запишите заново.");
      stop("interrupted");
    };
    r.onstop = () => {
      if (segStart.current != null) {
        acc.current += now() - segStart.current;
        segStart.current = null;
      }
      const type = blobType(r.mimeType || mime, apple);
      const blob = new Blob(chunks.current, { type });
      cleanup();
      if (blob.size === 0) {
        setError("Запись не сохранилась. Попробуйте ещё раз или загрузите файл.");
        setState("error");
        return;
      }
      const durationSec = Math.round(acc.current / 100) / 10;
      setElapsed(durationSec);
      setTake({ blob, url: URL.createObjectURL(blob), mime: type, durationSec, source: "mic" });
      if (stopReason.current === "limit") setNotice(`Прошло ${Math.round(maxSec / 60)} минут — запись остановлена. Продолжение можно записать следующим рассказом.`);
      setState("stopped");
    };

    const track = s.getAudioTracks()[0];
    if (track) {
      track.onended = () => {
        if (rec.current && rec.current.state !== "inactive") {
          setNotice("Микрофон отключился (звонок или блокировка экрана). Мы сохранили то, что успели — прослушайте и отправьте.");
          stop("interrupted");
        }
      };
      track.onmute = () => pause("Запись на паузе: телефон занял микрофон (звонок или другое приложение). Нажмите «Продолжить».");
    }

    r.start(1000);
    segStart.current = now();
    setElapsed(0);
    setState("recording");
    void requestWake();
    timer.current = setInterval(() => {
      const sec = (acc.current + (segStart.current != null ? now() - segStart.current : 0)) / 1000;
      setElapsed(sec);
      if (sec >= maxSec) stop("limit");
    }, 250);
  }, [cleanup, maxSec, pause, requestWake, stop]);

  /** Выбросить дубль и вернуться к началу */
  const reset = useCallback(() => {
    setTake((t) => {
      if (t) URL.revokeObjectURL(t.url);
      return null;
    });
    setElapsed(0);
    setError(null);
    setNotice(null);
    setState("idle");
  }, []);

  /** Дубль из файла (диктофон, галерея) */
  const loadFile = useCallback((t: Take) => {
    setTake((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return t;
    });
    setElapsed(t.durationSec);
    setError(null);
    setNotice(null);
    setState("stopped");
  }, []);

  // Экран погас / вкладку свернули / уходим со страницы
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        pause("Запись на паузе: экран погас или вы переключились в другое приложение. Всё, что записано, сохранено.");
      } else if (rec.current?.state === "paused") {
        const track = stream.current?.getAudioTracks()[0];
        if (!track || track.readyState === "ended") {
          setNotice("Телефон отключил микрофон, пока экран был выключен. Мы сохранили то, что успели записать — прослушайте и отправьте.");
          stop("interrupted");
        }
      }
    };
    const onPageHide = () => stop("interrupted");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [pause, stop]);

  // Уход со страницы — отпускаем микрофон
  useEffect(
    () => () => {
      try {
        if (rec.current && rec.current.state !== "inactive") rec.current.stop();
      } catch {
        /* ignore */
      }
      cleanup();
    },
    [cleanup],
  );

  return { state, elapsed, take, error, notice, start, pause: () => pause(), resume, stop: () => stop("user"), reset, loadFile, setError };
}
