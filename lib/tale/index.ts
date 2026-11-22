import "server-only";
// Сказка для внуков (I8): готовые главы семьи → ai.run("tale") → ai.run("illustrate") × 3–4 в одном стиле.
// Строка в extras (type = 'tale'): data = { title, pages[{ text, illustrationPrompt }], … }.
// Картинки — bucket illustrations: <familyId>/<extraId>/p<i>-<время>.<ext>. Каждая страница пишет свой файл,
// поэтому параллельные картинки не перетирают друг друга в jsonb. Без Supabase — память процесса (data:-ссылки).
import { ai, AiUnavailableError } from "@/lib/ai";
import { BUCKETS, getDbOrNull } from "@/lib/db";
import { getFamilyStore, MemoryFamilyStore } from "@/lib/db/access";
import type { Extra, Story, Storyteller } from "@/lib/types";
import { knownWords, neutralizeChildName } from "./address";
import { cleanChildName, isTaleStory, pickTaleStories, taleInputStories } from "./pick";
import { TALE_MAX_PAGES, TALE_MIN_STORIES, TALE_STYLE, type TaleView } from "./types";

export * from "./types";

/** Сказка «пишется» дольше — считаем, что функция упала, и разрешаем начать заново. */
const WRITING_STALE_MS = 90 * 1000;
const IMAGE_URL_TTL = 60 * 60;

export interface TalePage {
  text: string;
  illustrationPrompt: string;
}

export interface TaleData {
  title: string | null;
  childName: string | null;
  storytellerName: string | null;
  style: string;
  storyIds: string[];
  pages: TalePage[];
  error: string | null;
}

export class TaleError extends Error {
  constructor(
    readonly code: "not_enough" | "busy" | "not_ready" | "bad_page" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "TaleError";
  }
}

// ---------------- главы семьи ----------------

interface TaleSource {
  storyteller: Pick<Storyteller, "name"> | null;
  stories: Story[];
}

async function loadSource(familyId: string): Promise<TaleSource> {
  const db = getDbOrNull();
  if (!db) {
    const store = getFamilyStore() as Partial<MemoryFamilyStore>;
    const st = [...(store.storytellers?.values() ?? [])]
      .filter((s) => s.family_id === familyId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    const stories = [...(store.stories?.values() ?? [])].filter((s) => s.family_id === familyId);
    return structuredClone({ storyteller: st ? { name: st.name } : null, stories });
  }
  const [st, stories] = await Promise.all([
    db.from("storytellers").select("name").eq("family_id", familyId).order("created_at", { ascending: true }).limit(1),
    db.from("stories").select("*").eq("family_id", familyId).eq("status", "ready").is("parent_story_id", null),
  ]);
  if (st.error) throw new Error(`рассказчик: ${st.error.message}`);
  if (stories.error) throw new Error(`главы: ${stories.error.message}`);
  return { storyteller: (st.data?.[0] as { name: string }) ?? null, stories: (stories.data ?? []) as Story[] };
}

// ---------------- строка extras и картинки ----------------

interface MemoryTale {
  extra: Extra;
  /** номер страницы → data:-ссылка */
  images: Map<number, string>;
}
const g = globalThis as { __taleMemory?: Map<string, MemoryTale> };
const memory = () => (g.__taleMemory ??= new Map());

async function latestTale(familyId: string): Promise<Extra | null> {
  const db = getDbOrNull();
  if (!db) return structuredClone(memory().get(familyId)?.extra ?? null);
  const { data, error } = await db
    .from("extras")
    .select("*")
    .eq("family_id", familyId)
    .eq("type", "tale")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`сказка: ${error.message}`);
  return (data?.[0] as Extra) ?? null;
}

async function saveTale(familyId: string, current: Extra | null, patch: { status: string; data: TaleData }): Promise<Extra> {
  const db = getDbOrNull();
  if (!db) {
    const now = new Date().toISOString();
    const prev = memory().get(familyId);
    const extra: Extra = {
      id: current?.id ?? crypto.randomUUID(),
      family_id: familyId,
      type: "tale",
      created_at: current?.created_at ?? now,
      ...patch,
      data: { ...patch.data },
      updated_at: now,
    };
    memory().set(familyId, { extra, images: prev?.images ?? new Map() });
    return structuredClone(extra);
  }
  const q = current
    ? db.from("extras").update(patch).eq("id", current.id).select("*").single()
    : db.from("extras").insert({ family_id: familyId, type: "tale", ...patch }).select("*").single();
  const { data, error } = await q;
  if (error || !data) throw new Error(`запись сказки: ${error?.message ?? "нет данных"}`);
  return data as Extra;
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg" };
const folder = (extra: Extra) => `${extra.family_id}/${extra.id}`;
const PAGE_FILE = /^p(\d+)-(\d+)\.[a-z]+$/;

/** Файлы картинок сказки: номер страницы → самый свежий путь (и все пути страницы — чтобы чистить старые). */
async function listImages(extra: Extra): Promise<Map<number, { latest: string; all: string[] }>> {
  const db = getDbOrNull();
  const out = new Map<number, { latest: string; all: string[]; ts: number }>();
  if (!db) return out;
  const { data, error } = await db.storage.from(BUCKETS.illustrations).list(folder(extra), { limit: 200 });
  if (error) throw new Error(`картинки сказки: ${error.message}`);
  for (const f of data ?? []) {
    const m = PAGE_FILE.exec(f.name);
    if (!m) continue;
    const page = Number(m[1]);
    const ts = Number(m[2]);
    const path = `${folder(extra)}/${f.name}`;
    const cur = out.get(page);
    if (!cur) out.set(page, { latest: path, all: [path], ts });
    else {
      cur.all.push(path);
      if (ts > cur.ts) Object.assign(cur, { latest: path, ts });
    }
  }
  return out;
}

async function imageUrls(extra: Extra, count: number): Promise<(string | null)[]> {
  const db = getDbOrNull();
  if (!db) {
    const images = memory().get(extra.family_id)?.images;
    return Array.from({ length: count }, (_, i) => images?.get(i) ?? null);
  }
  const files = await listImages(extra);
  const paths = Array.from({ length: count }, (_, i) => files.get(i)?.latest ?? null);
  const wanted = paths.filter((p): p is string => Boolean(p));
  if (wanted.length === 0) return paths.map(() => null);
  const { data, error } = await db.storage.from(BUCKETS.illustrations).createSignedUrls(wanted, IMAGE_URL_TTL);
  if (error) throw new Error(`ссылки на картинки: ${error.message}`);
  const byPath = new Map((data ?? []).map((d) => [d.path ?? "", d.signedUrl]));
  return paths.map((p) => (p ? (byPath.get(p) ?? null) : null));
}

async function removeImages(extra: Extra, page?: number): Promise<void> {
  const db = getDbOrNull();
  if (!db) {
    const images = memory().get(extra.family_id)?.images;
    if (page === undefined) images?.clear();
    else images?.delete(page);
    return;
  }
  const files = await listImages(extra);
  const paths = page === undefined ? [...files.values()].flatMap((f) => f.all) : (files.get(page)?.all ?? []);
  if (paths.length) await db.storage.from(BUCKETS.illustrations).remove(paths);
}

async function storeImage(extra: Extra, page: number, img: { imageBase64: string; mimeType: string }): Promise<string> {
  const mime = img.mimeType.split(";")[0]!.trim().toLowerCase();
  const ext = EXT[mime];
  if (!ext) throw new Error(`картинка: неизвестный формат ${mime}`);
  const db = getDbOrNull();
  if (!db) {
    const url = `data:${mime};base64,${img.imageBase64}`;
    const m = memory().get(extra.family_id);
    if (!m) throw new Error("сказка не найдена");
    m.images.set(page, url);
    return url;
  }
  const old = (await listImages(extra)).get(page)?.all ?? [];
  const path = `${folder(extra)}/p${page}-${Date.now()}.${ext}`;
  const up = await db.storage
    .from(BUCKETS.illustrations)
    .upload(path, Buffer.from(img.imageBase64, "base64"), { contentType: mime, upsert: true });
  if (up.error) throw new Error(`загрузка картинки: ${up.error.message}`);
  if (old.length) await db.storage.from(BUCKETS.illustrations).remove(old); // перегенерация — старую убираем
  const { data, error } = await db.storage.from(BUCKETS.illustrations).createSignedUrl(path, IMAGE_URL_TTL);
  if (error || !data) throw new Error(`ссылка на картинку: ${error?.message ?? "нет данных"}`);
  return data.signedUrl;
}

// ---------------- публичное API ----------------

function dataOf(extra: Extra | null): TaleData | null {
  if (!extra) return null;
  const d = extra.data as Partial<TaleData>;
  return {
    title: d.title ?? null,
    childName: d.childName ?? null,
    storytellerName: d.storytellerName ?? null,
    style: d.style ?? TALE_STYLE,
    storyIds: d.storyIds ?? [],
    pages: Array.isArray(d.pages) ? d.pages : [],
    error: d.error ?? null,
  };
}

const isStale = (extra: Extra) => Date.now() - Date.parse(extra.updated_at) > WRITING_STALE_MS;

export async function getTaleView(familyId: string): Promise<TaleView> {
  const [extra, src] = await Promise.all([latestTale(familyId), loadSource(familyId)]);
  const storiesReady = src.stories.filter(isTaleStory).length;
  const data = dataOf(extra);
  if (!extra || !data) {
    return { status: "none", title: null, childName: null, storytellerName: src.storyteller?.name ?? null, pages: [], illustrated: 0, storiesReady, error: null, updatedAt: null };
  }
  const stale = extra.status === "writing" && isStale(extra);
  const status = stale ? "failed" : extra.status === "ready" || extra.status === "writing" || extra.status === "failed" ? extra.status : "failed";
  const images = status === "ready" ? await imageUrls(extra, data.pages.length) : [];
  const pages = status === "ready" ? data.pages.map((p, i) => ({ text: p.text, image: images[i] ?? null, imageError: null })) : [];
  return {
    status,
    title: data.title,
    childName: data.childName,
    storytellerName: data.storytellerName ?? src.storyteller?.name ?? null,
    pages,
    illustrated: images.filter(Boolean).length,
    storiesReady,
    error: stale ? "Сказка не дописалась — попробуйте ещё раз" : data.error,
    updatedAt: extra.updated_at,
  };
}

/** Написать текст сказки (шаг tale). again — новая версия мимо кэша, старые картинки удаляются. */
export async function writeTale(familyId: string, opts: { childName?: unknown; again?: boolean } = {}): Promise<TaleView> {
  const [current, src] = await Promise.all([latestTale(familyId), loadSource(familyId)]);
  if (current?.status === "writing" && !isStale(current)) throw new TaleError("busy", "Сказка уже пишется — подождите минутку");
  if (current?.status === "ready" && !opts.again) return getTaleView(familyId);

  const stories = pickTaleStories(src.stories);
  if (stories.length < TALE_MIN_STORIES) {
    const need = TALE_MIN_STORIES - stories.length;
    throw new TaleError("not_enough", `Для сказки нужно хотя бы ${TALE_MIN_STORIES} готовые главы — запишите ещё ${need === 1 ? "одну историю" : `${need} истории`}`);
  }
  const prev = dataOf(current);
  const childName = opts.childName === undefined ? (prev?.childName ?? null) : cleanChildName(opts.childName);
  const storytellerName = src.storyteller?.name ?? "дедушка";
  const base: TaleData = {
    title: null,
    childName,
    storytellerName,
    style: TALE_STYLE,
    storyIds: stories.map((s) => s.id),
    pages: [],
    error: null,
  };

  let extra = await saveTale(familyId, current, { status: "writing", data: base });
  if (current) await removeImages(extra).catch((e) => console.error("[tale] старые картинки:", e instanceof Error ? e.message : e));

  try {
    const tale = await ai.run(
      "tale",
      { storytellerName, ...(childName ? { childName } : {}), stories: taleInputStories(stories) },
      { noCache: Boolean(opts.again) },
    );
    let pages = tale.pages
      .filter((p) => p.text.trim())
      .slice(0, TALE_MAX_PAGES)
      .map((p) => ({ text: p.text.trim(), illustrationPrompt: p.illustrationPrompt.trim() || p.text.trim() }));
    if (pages.length === 0) throw new Error("в сказке нет страниц");
    let title = tale.title.trim() || "Сказка";
    if (!childName) {
      // Имени внука не дали — модель не должна его придумывать (#44): нейтральное обращение «дружок».
      const known = knownWords(storytellerName, ...stories.flatMap((s) => [s.title, s.text_ru]));
      title = neutralizeChildName(title, known);
      pages = pages.map((p, i) => ({ ...p, text: neutralizeChildName(p.text, known, { vocative: i === pages.length - 1 }) }));
    }
    extra = await saveTale(familyId, extra, { status: "ready", data: { ...base, title, pages } });
  } catch (e) {
    const message =
      e instanceof AiUnavailableError ? "Сказочник сейчас занят — попробуйте через пару минут" : "Сказка не получилась — попробуйте ещё раз";
    console.error("[tale] текст:", e instanceof Error ? e.message : e);
    await saveTale(familyId, extra, { status: "failed", data: { ...base, error: message } });
    throw new TaleError(e instanceof AiUnavailableError ? "unavailable" : "not_ready", message);
  }
  return getTaleView(familyId);
}

/** Нарисовать картинку страницы (шаг illustrate, общий стиль). regenerate — мимо кэша, старая заменяется. */
export async function illustratePage(familyId: string, page: number, opts: { regenerate?: boolean } = {}): Promise<{ page: number; image: string }> {
  const extra = await latestTale(familyId);
  const data = dataOf(extra);
  if (!extra || !data || extra.status !== "ready") throw new TaleError("not_ready", "Сначала сказке нужен текст");
  const p = data.pages[page];
  if (!Number.isInteger(page) || !p) throw new TaleError("bad_page", "Такой страницы в сказке нет");

  if (!opts.regenerate) {
    const existing = (await imageUrls(extra, data.pages.length))[page];
    if (existing) return { page, image: existing };
  }
  try {
    const img = await ai.run("illustrate", { prompt: p.illustrationPrompt, style: data.style }, { noCache: Boolean(opts.regenerate) });
    return { page, image: await storeImage(extra, page, img) };
  } catch (e) {
    console.error(`[tale] картинка ${page}:`, e instanceof Error ? e.message : e);
    if (e instanceof AiUnavailableError) throw new TaleError("unavailable", "Художник сейчас занят — попробуйте через минуту");
    throw new TaleError("not_ready", "Картинка не получилась — попробуйте ещё раз");
  }
}

/** Вся сказка за один вызов: текст, затем все картинки параллельно. Неудачные картинки не роняют сказку. */
export async function createTale(familyId: string, opts: { childName?: unknown; again?: boolean } = {}): Promise<TaleView> {
  const view = await writeTale(familyId, opts);
  await Promise.allSettled(view.pages.map((_, i) => illustratePage(familyId, i)));
  return getTaleView(familyId);
}
