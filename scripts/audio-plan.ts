// #325: план перекодировки голосов в копию для iPhone (чистая логика, без сети — её тестирует audio-plan.test.ts).
// Исполняет scripts/audio-transcode.ts (workflow audio-transcode). Копия — `*.aac.m4a` рядом с оригиналом
// (lib/book/playable.ts); оригинал и stories.audio_url не трогаем никогда.
import { isPlayableCopy, playablePath } from "@/lib/book/playable";

/** Голос истории, который может играть плеер (основной ответ или уточнение). */
export interface AudioRow {
  storyId: string;
  familyId: string;
  demo: boolean;
  /** Путь в бакете audio (без префикса `audio/`) */
  path: string;
  durationSec: number | null;
}

/** Объект в бакете: когда записан и сколько весит. */
export interface StoredObject {
  updatedAt: string;
  size: number;
}

/** Что показал ffprobe: контейнер (format_name) и кодеки аудиодорожек. */
export interface Probe {
  format: string;
  codecs: string[];
}

export type Decision =
  | "missing" // файла нет в бакете — нечего перекодировать
  | "copy_ok" // копия уже есть и не старше оригинала
  | "plays" // оригинал и так играет на любом iPhone (AAC / MP3 / WAV)
  | "probe" // m4a / mp4 / 3gp / aac — внутри может быть Opus или AMR: смотрим ffprobe
  | "convert" // нужна копия
  | "stale"; // копия есть, но оригинал перезаписан позже (голоса демо из /admin) — сделать заново

/** Без ffprobe играет на iPhone (Safari любой версии). */
const PLAYS_BY_EXT = new Set(["mp3", "wav"]);
/** Контейнер, который Safari открывает, — решает кодек внутри. */
const PROBE_EXT = new Set(["m4a", "mp4", "aac", "mov", "3gp"]);

export function extOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Решение по одной записи до ffprobe. objects — содержимое бакета по путям. */
export function decide(path: string, objects: ReadonlyMap<string, StoredObject>): Decision {
  const orig = objects.get(path);
  if (!orig) return "missing";
  const copyPath = playablePath(path);
  const copy = copyPath ? objects.get(copyPath) : undefined;
  if (copy) return Date.parse(copy.updatedAt) >= Date.parse(orig.updatedAt) ? "copy_ok" : "stale";
  const ext = extOf(path);
  if (PLAYS_BY_EXT.has(ext)) return "plays";
  if (PROBE_EXT.has(ext)) return "probe";
  return "convert"; // webm, weba, ogg, opus и всё незнакомое — ffmpeg разберётся
}

/** iPhone до iOS 17 играет AAC / MP3 / ALAC / PCM в mp4 / mov / mp3 / wav / adts; Opus, Vorbis, AMR — нет. */
export function playsOnOldIphone(p: Probe): boolean {
  const okCodec = (c: string) => c === "aac" || c === "mp3" || c === "alac" || c.startsWith("pcm_");
  const okFormat = /(^|,)(mov|mp4|m4a|mp3|wav|aac)(,|$)/.test(p.format);
  return p.codecs.length > 0 && p.codecs.every(okCodec) && okFormat;
}

/** Копия годится к загрузке: AAC в mp4, длительность есть и близка к записанной (если её знаем). */
export function copyLooksRight(out: Probe & { durationSec: number }, expectedSec: number | null): { ok: boolean; why?: string } {
  if (!out.codecs.includes("aac")) return { ok: false, why: `кодек ${out.codecs.join(",") || "—"}` };
  if (!/(^|,)(mov|mp4|m4a)(,|$)/.test(out.format)) return { ok: false, why: `контейнер ${out.format}` };
  if (!(out.durationSec > 0.3)) return { ok: false, why: "пустая" };
  if (expectedSec && expectedSec > 0) {
    const tol = Math.max(5, expectedSec * 0.15);
    if (Math.abs(out.durationSec - expectedSec) > tol)
      return { ok: false, why: `длительность ${out.durationSec.toFixed(1)} с, ждали ${expectedSec} с` };
  }
  return { ok: true };
}

/** Аргументы ffmpeg: только первая аудиодорожка → AAC 96 кбит/с, moov в начале (iPhone начинает играть сразу). */
export function ffmpegArgs(input: string, output: string): string[] {
  return ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", input, "-vn", "-map", "0:a:0", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", "-f", "mp4", output];
}

/** Записи без копий-самих-себя и без повторов (одна запись может быть у нескольких строк — демо). */
export function uniqueRows(rows: readonly AudioRow[]): AudioRow[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (!r.path || /^https?:\/\//i.test(r.path) || isPlayableCopy(r.path) || seen.has(r.path)) return false;
    seen.add(r.path);
    return true;
  });
}

/** Запуск по расписанию с большим планом — только план: большой пакет разбирает человек вручную (dry run → apply). */
export const SCHEDULED_MAX = 50;

export function applyLimit(opts: { apply: boolean; scheduled: boolean; todo: number; max: number }): { apply: boolean; why?: string } {
  if (!opts.apply) return { apply: false };
  if (opts.scheduled && opts.todo > SCHEDULED_MAX)
    return { apply: false, why: `по расписанию больше ${SCHEDULED_MAX} записей (${opts.todo}) — только план; запустите вручную с apply` };
  if (opts.todo > opts.max) return { apply: true, why: `сделаем первые ${opts.max} из ${opts.todo}, остальные — следующим запуском` };
  return { apply: true };
}

export const DECISION_RU: Record<Decision | "done" | "failed" | "plays_probe", string> = {
  missing: "нет файла в Storage",
  copy_ok: "копия уже есть",
  plays: "играет и так (mp3 / wav)",
  probe: "проверить ffprobe",
  plays_probe: "играет и так (AAC внутри)",
  convert: "нужна копия",
  stale: "копия устарела (оригинал новее)",
  done: "копия сделана",
  failed: "ошибка",
};
