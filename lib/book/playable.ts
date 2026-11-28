// #325: копия записи, которую играет любой iPhone (AAC в m4a), лежит в бакете audio рядом с оригиналом:
//   fam/st/story-<uuid>.webm → fam/st/story-<uuid>.aac.m4a
// Оригинал и stories.audio_url не меняются (расшифровка, архив, удаление семьи — как раньше). Копию делает
// workflow audio-transcode (ffmpeg в GitHub Actions; на Vercel ffmpeg нет), плеер берёт её, если она есть.
// Суффикс «.aac.m4a» не совпадает ни с одним оригиналом: свои пути — `<kind>-<uuid>.<ext>` с одним расширением
// (isOwnAudioPath), поэтому копию нельзя выдать за запись, а запись — за копию. Без server-only: импортирует скрипт.

export const PLAYABLE_SUFFIX = ".aac.m4a";

/** Это сама копия для iPhone (её не перекодируем и не ищем у неё копию). */
export function isPlayableCopy(path: string): boolean {
  return path.toLowerCase().endsWith(PLAYABLE_SUFFIX);
}

/** Путь копии для пути в бакете: расширение оригинала → `.aac.m4a`. Для https-ссылок и самой копии — null. */
export function playablePath(path: string | null | undefined): string | null {
  if (!path || /^https?:\/\//i.test(path) || isPlayableCopy(path)) return null;
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  const base = dot > slash + 1 ? path.slice(0, dot) : path;
  return `${base}${PLAYABLE_SUFFIX}`;
}
