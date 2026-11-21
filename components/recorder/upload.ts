"use client";
// Загрузка аудио прямо в Storage: /api/upload-url → PUT по подписанной ссылке (мимо функции Vercel).
import type { Take } from "./useRecorder";

export class UploadError extends Error {}

export async function postJson<T>(url: string, token: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-family-token": token },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string; error?: string };
  if (!res.ok) {
    const err = new UploadError(data.message ?? "Не получилось отправить. Проверьте интернет и попробуйте ещё раз.");
    (err as UploadError & { status?: number; code?: string }).status = res.status;
    (err as UploadError & { code?: string }).code = data.error;
    throw err;
  }
  return data;
}

function put(url: string, blob: Blob, mime: string, onProgress?: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", mime);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new UploadError(`Хранилище ответило ${xhr.status}. Попробуйте ещё раз.`)));
    xhr.onerror = () => reject(new UploadError("Пропал интернет во время отправки. Запись у вас — нажмите «Отправить» ещё раз."));
    xhr.ontimeout = () => reject(new UploadError("Отправка заняла слишком долго. Попробуйте ещё раз."));
    xhr.timeout = 5 * 60_000;
    xhr.send(blob);
  });
}

/** Загрузить дубль; вернуть путь в bucket audio. */
export async function uploadAudio(opts: {
  token: string;
  storytellerId: string;
  kind: "story" | "consent";
  take: Take;
  onProgress?: (p: number) => void;
}): Promise<string> {
  const { path, signedUrl } = await postJson<{ path: string; signedUrl: string | null }>("/api/upload-url", opts.token, {
    storytellerId: opts.storytellerId,
    kind: opts.kind,
    mime: opts.take.mime,
  });
  if (signedUrl) await put(signedUrl, opts.take.blob, opts.take.mime, opts.onProgress);
  opts.onProgress?.(1);
  return path;
}

/** Длительность файла из диктофона: читаем метаданные через <audio>. */
export function fileDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const a = new Audio();
    const done = (v: number) => {
      a.src = "";
      resolve(Number.isFinite(v) && v > 0 ? Math.round(v * 10) / 10 : 0);
    };
    const t = setTimeout(() => done(0), 4000);
    a.preload = "metadata";
    a.onloadedmetadata = () => {
      clearTimeout(t);
      done(a.duration);
    };
    a.onerror = () => {
      clearTimeout(t);
      done(0);
    };
    a.src = url;
  });
}
