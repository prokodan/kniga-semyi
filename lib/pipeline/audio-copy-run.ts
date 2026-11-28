import "server-only";
// #347: после загрузки записи (POST /api/stories, голос демо в /admin) — в after(), не задерживая ответ:
// если iPhone < 17 её не сыграет (webm / ogg / Opus в mp4), просим workflow audio-transcode сделать копию
// именно этой записи. Нужен GITHUB_TOKEN с правом actions (тот же, что у бота, lib/bot/config.ts). Нет токена,
// локально / в CI или GitHub не ответил — молча пропускаем: копию сделает ночной audio-transcode (страховка).
// В лог — только короткий id и код ошибки.
import { after } from "next/server";
import { getBotConfig } from "@/lib/bot/config";
import { createGithub } from "@/lib/bot/github";
import { BUCKETS, getDbOrNull } from "@/lib/db";
import { env } from "@/lib/env";
import { AUDIO_TRANSCODE_WORKFLOW, copyNeedByHead, copyNeedByPath, HEAD_BYTES, transcodeInputs, transcodeTarget } from "./audio-copy";

async function headOf(path: string): Promise<Uint8Array | null> {
  const db = getDbOrNull();
  if (!db) return null;
  const signed = await db.storage.from(BUCKETS.audio).createSignedUrl(path, 120);
  if (signed.error || !signed.data) return null;
  const res = await fetch(signed.data.signedUrl, { headers: { range: `bytes=0-${HEAD_BYTES - 1}` }, signal: AbortSignal.timeout(8_000) });
  if (!res.ok) return null;
  return new Uint8Array(await res.arrayBuffer()).subarray(0, HEAD_BYTES);
}

/** Нужна ли копия и, если да, запуск workflow. Возвращает, что сделали (для тестов / логов). */
export async function requestPlayableCopy(storyId: string, path: string): Promise<"skipped" | "not_needed" | "dispatched" | "failed"> {
  const target = transcodeTarget(env.vercelEnv());
  const cfg = getBotConfig();
  if (!target || !cfg.githubToken) return "skipped";
  try {
    const need = copyNeedByPath(path);
    if (need === "no") return "not_needed";
    if (need === "sniff") {
      const head = await headOf(path);
      if (head && !copyNeedByHead(head)) return "not_needed"; // AAC внутри — iPhone сыграет и так
    }
    await createGithub({ repo: cfg.repo, token: cfg.githubToken }).dispatch(AUDIO_TRANSCODE_WORKFLOW, transcodeInputs(target, storyId));
    return "dispatched";
  } catch (e) {
    console.error(`[audio-copy] ${storyId.slice(0, 8)}: ${e instanceof Error ? e.message.slice(0, 120) : "error"}`);
    return "failed";
  }
}

/** То же в фоне после ответа (after). Вне запроса Next (тесты, скрипты) — ничего. */
export function playableCopyInBackground(storyId: string, path: string) {
  try {
    after(() => requestPlayableCopy(storyId, path).then(() => undefined));
  } catch {
    // вне запроса Next
  }
}
