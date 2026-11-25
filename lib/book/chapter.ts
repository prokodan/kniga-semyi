import "server-only";
// Данные главы и страницы голоса (I3). Только сервер.
// Текст главы — те же поля, что отдаёт GET /api/stories/:id (text_ru, text_ko, title, quote, *_ko);
// здесь дополнительно рассказчик, фото и подписанная ссылка на аудио — их нет в ответе конвейера.
// Supabase (service-ключ) — прод; без него — память процесса, общая с I1/I2 (локальный запуск, mock).
import { env } from "@/lib/env";
import type { Family, Story, Storyteller } from "@/lib/types";
import { BUCKETS, getDbOrNull } from "@/lib/db";
import { getFamilyStore, isTokenShape, MemoryFamilyStore } from "@/lib/db/access";

export interface ChapterData {
  story: Story;
  storyteller: Storyteller | null;
  family: Pick<Family, "id" | "name">;
}

/** Ссылка на фото живёт час (страница главы), аудио — 12 часов: QR на слайде сканируют в течение дня. */
const PHOTO_TTL = 60 * 60;
const AUDIO_TTL = 12 * 60 * 60;

/**
 * История с рассказчиком и семьёй.
 * token задан → проверяется ссылка семьи (страница главы); не задан → вызывающий уже проверил подпись QR.
 * null — истории нет или токен не подходит (наружу одинаково: не раскрываем, есть ли история).
 */
export async function loadChapter(storyId: string, opts: { token?: string } = {}): Promise<ChapterData | null> {
  if (!/^[0-9a-f-]{8,64}$/i.test(storyId)) return null;
  if (opts.token !== undefined && !isTokenShape(opts.token)) return null;

  const db = getDbOrNull();
  if (!db) {
    // Не instanceof: в dev у каждого маршрута своя копия модуля, а хранилище общее (globalThis).
    const store = getFamilyStore() as Partial<MemoryFamilyStore>;
    if (!store.stories || !store.families || !store.storytellers) return null;
    const story = store.stories.get(storyId);
    if (!story) return null;
    const family = store.families.get(story.family_id);
    if (opts.token !== undefined && family?.access_token !== opts.token) return null;
    const storyteller = store.storytellers.get(story.storyteller_id) ?? null;
    return structuredClone({ story, storyteller, family: { id: story.family_id, name: family?.name ?? "Книга семьи" } });
  }

  const { data: story, error } = await db.from("stories").select("*").eq("id", storyId).maybeSingle();
  if (error) throw new Error(`чтение истории: ${error.message}`);
  if (!story) return null;

  let familyQuery = db.from("families").select("id, name").eq("id", story.family_id);
  if (opts.token !== undefined) familyQuery = familyQuery.eq("access_token", opts.token);
  const [fam, st] = await Promise.all([
    familyQuery.maybeSingle(),
    db.from("storytellers").select("*").eq("id", story.storyteller_id).maybeSingle(),
  ]);
  if (fam.error) throw new Error(`семья истории: ${fam.error.message}`);
  if (!fam.data) return null;
  return { story: story as Story, storyteller: (st.data as Storyteller | null) ?? null, family: fam.data as ChapterData["family"] };
}

/** Путь в бакете из audio_url: `fam/st/story-1.m4a`, можно с префиксом `audio/`. https-ссылку отдаём как есть. */
export function audioStoragePath(audioUrl: string): string {
  return audioUrl.replace(/^\/+/, "").replace(new RegExp(`^${BUCKETS.audio}/`), "");
}

/** Подписанная ссылка на голос. null — аудио нет или Storage не настроен (локальный режим). */
export async function audioSignedUrl(audioUrl: string | null): Promise<string | null> {
  if (!audioUrl) return null;
  if (/^https?:\/\//i.test(audioUrl)) return audioUrl;
  const db = getDbOrNull();
  if (!db) return null;
  const { data, error } = await db.storage.from(BUCKETS.audio).createSignedUrl(audioStoragePath(audioUrl), AUDIO_TTL);
  if (error || !data) {
    console.error("[chapter] ссылка на аудио:", error?.message);
    return null;
  }
  return data.signedUrl;
}

/** Подписанная ссылка на фото рассказчика (или null). */
export async function photoSignedUrl(photoPath: string | null, ttl = PHOTO_TTL): Promise<string | null> {
  if (!photoPath) return null;
  if (/^https?:\/\//i.test(photoPath)) return photoPath;
  const db = getDbOrNull();
  if (!db) return null;
  const { data, error } = await db.storage.from(BUCKETS.photos).createSignedUrl(photoPath, ttl);
  return error || !data ? null : data.signedUrl;
}

/** Годы жизни для подписи: «1941 г. р.» или «1941–2020». */
export function lifeYears(st: Pick<Storyteller, "birth_year" | "death_year"> | null): string | null {
  if (!st?.birth_year) return null;
  return st.death_year ? `${st.birth_year}–${st.death_year}` : `${st.birth_year} г. р.`;
}

/** Origin текущего запроса для абсолютной ссылки в QR (на Vercel — x-forwarded-*), иначе PROD_URL. */
export async function requestOrigin(): Promise<string> {
  const { headers } = await import("next/headers");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host) {
    const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.|\[::1\])/.test(host) ? "http" : "https");
    return `${proto.split(",")[0]!.trim()}://${host}`;
  }
  return env.prodUrl() ?? "http://localhost:3000";
}

export interface AudioPart {
  src: string;
  durationSec: number | null;
}

/**
 * Голос главы целиком: основной ответ + голосовые ответы на уточнения (parent_story_id), по времени записи.
 * Раньше /listen играл только основной ответ — глава, где рассказ продолжался в уточнениях, «обрывалась»
 * (первый велосипед: 22 с из ~2 мин). Части без файла пропускаются.
 */
export async function chapterAudioParts(story: Pick<Story, "id" | "audio_url" | "duration_sec">): Promise<AudioPart[]> {
  const db = getDbOrNull();
  let children: Pick<Story, "audio_url" | "duration_sec" | "created_at">[] = [];
  if (db) {
    const { data, error } = await db
      .from("stories")
      .select("audio_url, duration_sec, created_at")
      .eq("parent_story_id", story.id)
      .not("audio_url", "is", null)
      .neq("status", "skipped") // «не буду» и «да, Уштобе» на переспрос — не часть рассказа
      .order("created_at", { ascending: true });
    if (error) console.error("[chapter] уточнения для голоса:", error.message);
    children = (data as typeof children | null) ?? [];
  } else {
    const store = getFamilyStore() as Partial<MemoryFamilyStore>;
    children = [...(store.stories?.values() ?? [])]
      .filter((s) => s.parent_story_id === story.id && s.audio_url && s.status !== "skipped")
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  const all = [story, ...children];
  const urls = await Promise.all(all.map((s) => audioSignedUrl(s.audio_url)));
  return all.flatMap((s, i) => (urls[i] ? [{ src: urls[i]!, durationSec: s.duration_sec != null ? Number(s.duration_sec) : null }] : []));
}
