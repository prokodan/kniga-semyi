// #347: копия записи для iPhone < 17 (AAC `*.aac.m4a`, #325) — сразу после загрузки, а не ночью.
// Чистая логика без сети и базы (тестирует audio-copy.test.ts); запуск — lib/pipeline/audio-copy-run.ts.
// На Vercel ffmpeg нет, поэтому сервер только просит GitHub Actions перекодировать ОДНУ запись (workflow
// audio-transcode с входом story). Ночной запуск audio-transcode остаётся страховкой (сбой запроса, нет токена).
import { isPlayableCopy } from "@/lib/book/playable";

export const AUDIO_TRANSCODE_WORKFLOW = "audio-transcode.yml";

/** Сколько байт начала файла смотрим: у записей MediaRecorder (mp4) заголовок moov — в начале. */
export const HEAD_BYTES = 64 * 1024;

export type CopyNeed = "no" | "yes" | "sniff";

function ext(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** По расширению: mp3 / wav играют всегда; m4a / mp4 / … — решает кодек внутри (sniff); webm / ogg / opus — нужна. */
export function copyNeedByPath(path: string | null | undefined): CopyNeed {
  if (!path || /^https?:\/\//i.test(path) || isPlayableCopy(path)) return "no";
  const e = ext(path);
  if (e === "mp3" || e === "wav") return "no";
  if (["m4a", "mp4", "aac", "mov", "3gp"].includes(e)) return "sniff";
  return "yes";
}

const has = (buf: Uint8Array, s: string) => Buffer.from(buf).includes(Buffer.from(s, "latin1"));

/**
 * По началу mp4: кодек дорожки (fourcc в stsd). Opus / AMR / FLAC — копия нужна; только mp4a (AAC, MP3) — играет.
 * Ничего не нашли (moov в конце, обрезано) — «нужна»: workflow сам проверит ffprobe и пропустит, если играет.
 */
export function copyNeedByHead(head: Uint8Array): boolean {
  if (["Opus", "samr", "sawb", "fLaC"].some((c) => has(head, c))) return true;
  return !has(head, "mp4a") && !has(head, "alac");
}

/** Куда workflow: прод → prod, превью → staging (#211), локально / CI — никуда. */
export function transcodeTarget(vercelEnv: "production" | "preview" | "development"): "prod" | "staging" | null {
  return vercelEnv === "production" ? "prod" : vercelEnv === "preview" ? "staging" : null;
}

/** Входы workflow_dispatch для одной записи (строки — так их принимает GitHub REST). */
export function transcodeInputs(target: "prod" | "staging", storyId: string): Record<string, string> {
  return { target, apply: "true", max: "1", story: storyId, comment: "" };
}
