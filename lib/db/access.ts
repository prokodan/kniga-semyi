import "server-only";
// Доступ семьи по ссылке с токеном (I1, согласовано с Z6). Только сервер.
// SupabaseFamilyStore — прод (service-ключ), MemoryFamilyStore — тесты и локальный запуск без базы
// (тогда аудио и фото не грузятся в Storage, а путь просто записывается в строку).
import { randomBytes, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Family, LifeBlock, Story, Storyteller } from "@/lib/types";
import { LIFE_BLOCKS } from "@/lib/types";
import { MemoryInterviewRepo } from "@/lib/interview/repo";
import { BUCKETS, getDbOrNull } from "./index";

/** Токен ссылки семьи: 64 hex (два uuid без дефисов, как default в миграции). */
const TOKEN_RE = /^[a-f0-9]{32,128}$/i;
export function isTokenShape(token: string): boolean {
  return TOKEN_RE.test(token);
}

export type StorySummary = Pick<Story, "id" | "storyteller_id" | "question_id" | "block" | "status" | "parent_story_id" | "created_at"> &
  Partial<Pick<Story, "title">>;

export interface FamilyView {
  family: Family;
  storytellers: Storyteller[];
  /** Рассказчик по умолчанию — первый добавленный */
  storyteller: Storyteller | null;
  stories: StorySummary[];
}

export interface NewFamily {
  name: string;
  gift_date: string | null;
  contact: string | null;
  storyteller: { name: string; name_ko: string | null; birth_year: number | null; birth_place: string | null };
  photo: { bytes: Uint8Array; contentType: string } | null;
}

export type AudioKind = "story" | "consent";

export interface NewStory {
  storyteller_id: string;
  audio_path: string;
  question_id: string | null;
  block: LifeBlock | null;
  duration_sec: number | null;
  session_id: string | null;
  /** Голосовой ответ на уточнение агента: основная история вопроса (I2 только расшифрует) */
  parent_story_id: string | null;
}

export class AccessError extends Error {
  constructor(
    readonly code: "bad_request" | "forbidden" | "not_found" | "consent_required",
    message: string,
  ) {
    super(message);
    this.name = "AccessError";
  }
}

export interface FamilyStore {
  /** true — настоящая база и Storage; false — память процесса */
  readonly persistent: boolean;
  createFamily(input: NewFamily): Promise<{ family: Family; storyteller: Storyteller }>;
  getFamilyByToken(token: string): Promise<FamilyView | null>;
  /** Подписанная ссылка на загрузку в bucket audio. signedUrl = null — загрузка не нужна (память). */
  signAudioUpload(path: string): Promise<{ signedUrl: string | null }>;
  /** Временная ссылка на чтение фото рассказчика */
  photoUrl(path: string): Promise<string | null>;
  saveConsent(storytellerId: string, audioPath: string): Promise<Storyteller>;
  createStory(familyId: string, input: NewStory): Promise<Story>;
}

// ---------------- общие правила ----------------

const AUDIO_EXT: Record<string, string> = {
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/aac": "aac",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/3gpp": "3gp",
  "video/mp4": "m4a", // часть Android-диктофонов отдаёт так
  "video/webm": "webm",
};

/** Базовый mime без параметров: "audio/webm;codecs=opus" → "audio/webm" */
export function baseMime(mime: string): string {
  return (mime.split(";")[0] ?? "").trim().toLowerCase();
}

export function audioExt(mime: string): string | null {
  return AUDIO_EXT[baseMime(mime)] ?? null;
}

/** Путь в bucket audio: <familyId>/<storytellerId>/<kind>-<uuid>.<ext> */
export function audioPath(familyId: string, storytellerId: string, kind: AudioKind, mime: string): string {
  const ext = audioExt(mime);
  if (!ext) throw new AccessError("bad_request", "Этот формат аудио не подходит. Подойдут m4a, mp3, webm, ogg, wav.");
  return `${familyId}/${storytellerId}/${kind}-${randomUUID()}.${ext}`;
}

/** Путь принадлежит семье и рассказчику и выглядит как наш (без «..» и чужих папок). */
export function isOwnAudioPath(path: string, familyId: string, storytellerId: string, kind?: AudioKind): boolean {
  const re = /^[A-Za-z0-9-]+\/[A-Za-z0-9-]+\/(story|consent)-[A-Za-z0-9-]+\.[a-z0-9]{2,5}$/;
  if (!re.test(path)) return false;
  if (!path.startsWith(`${familyId}/${storytellerId}/`)) return false;
  return kind ? path.split("/")[2]!.startsWith(`${kind}-`) : true;
}

export function findStoryteller(view: FamilyView, storytellerId: string): Storyteller {
  const st = view.storytellers.find((s) => s.id === storytellerId);
  if (!st) throw new AccessError("forbidden", "Рассказчик не из этой семьи");
  return st;
}

/** Прогресс «3 из 8»: блоки, где у рассказчика есть хотя бы один рассказ. Статус конвейера не важен:
 *  запись сохранена, упавший шаг I2 перезапускается. Ответы на уточнения — часть основной истории. */
export function blockProgress(stories: StorySummary[], storytellerId?: string) {
  const covered = new Set<LifeBlock>();
  let count = 0;
  for (const s of stories) {
    if (s.parent_story_id) continue;
    if (storytellerId && s.storyteller_id !== storytellerId) continue;
    count += 1;
    if (s.block && (LIFE_BLOCKS as readonly string[]).includes(s.block)) covered.add(s.block);
  }
  return { covered: LIFE_BLOCKS.filter((b) => covered.has(b)), done: covered.size, total: LIFE_BLOCKS.length, stories: count };
}

// ---------------- Memory ----------------

export class MemoryFamilyStore implements FamilyStore {
  readonly persistent = false;
  families = new Map<string, Family>();
  storytellers = new Map<string, Storyteller>();

  /** stories — общая карта с интервью-агентом и конвейером в локальном режиме */
  constructor(readonly stories: Map<string, Story> = new Map()) {}

  async createFamily(input: NewFamily) {
    const now = new Date().toISOString();
    const family: Family = {
      id: randomUUID(),
      name: input.name,
      access_token: randomBytes(32).toString("hex"),
      gift_date: input.gift_date,
      source: "family",
      contact: input.contact,
      archive_consent: false,
      is_demo: false,
      created_at: now,
      updated_at: now,
    };
    const id = randomUUID();
    const storyteller: Storyteller = {
      id,
      family_id: family.id,
      ...input.storyteller,
      death_year: null,
      photo_url: input.photo ? `${family.id}/${id}.jpg` : null,
      consent_audio_url: null,
      consent_at: null,
      created_at: now,
      updated_at: now,
    };
    this.families.set(family.id, family);
    this.storytellers.set(storyteller.id, storyteller);
    return { family: structuredClone(family), storyteller: structuredClone(storyteller) };
  }

  async getFamilyByToken(token: string) {
    if (!isTokenShape(token)) return null;
    const family = [...this.families.values()].find((f) => f.access_token === token);
    if (!family) return null;
    const storytellers = [...this.storytellers.values()]
      .filter((s) => s.family_id === family.id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const stories = [...this.stories.values()]
      .filter((s) => s.family_id === family.id && s.status !== "skipped") // ответ-отказ — не глава
      .map(({ id, storyteller_id, question_id, block, status, parent_story_id, created_at, title }) => ({ id, storyteller_id, question_id, block, status, parent_story_id, created_at, title }));
    return structuredClone({ family, storytellers, storyteller: storytellers[0] ?? null, stories });
  }

  async signAudioUpload() {
    return { signedUrl: null };
  }

  async photoUrl() {
    return null;
  }

  async saveConsent(storytellerId: string, audioPath: string) {
    const st = this.storytellers.get(storytellerId);
    if (!st) throw new AccessError("not_found", "Рассказчик не найден");
    st.consent_audio_url = audioPath;
    st.consent_at = new Date().toISOString();
    return structuredClone(st);
  }

  async createStory(familyId: string, input: NewStory) {
    const now = new Date().toISOString();
    const story: Story = {
      id: randomUUID(),
      family_id: familyId,
      storyteller_id: input.storyteller_id,
      session_id: input.session_id,
      parent_story_id: input.parent_story_id,
      question_id: input.question_id,
      block: input.block,
      audio_url: input.audio_path,
      duration_sec: input.duration_sec,
      transcript: null,
      text_ru: null,
      text_ko: null,
      title: null,
      title_ko: null,
      quote: null,
      quote_ko: null,
      facts: [],
      followups: [],
      status: "uploaded",
      error: null,
      sort_order: null,
      created_at: now,
      updated_at: now,
    };
    this.stories.set(story.id, story);
    return structuredClone(story);
  }
}

// ---------------- Supabase ----------------

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`${what}: ${error?.message ?? "нет данных"}`);
}

export class SupabaseFamilyStore implements FamilyStore {
  readonly persistent = true;
  constructor(private db: SupabaseClient) {}

  async createFamily(input: NewFamily) {
    const { data: family, error } = await this.db
      .from("families")
      .insert({ name: input.name, gift_date: input.gift_date, contact: input.contact, source: "family" })
      .select("*")
      .single();
    if (error || !family) fail("создание семьи", error);

    const { data: st, error: stError } = await this.db
      .from("storytellers")
      .insert({ family_id: family.id, ...input.storyteller })
      .select("*")
      .single();
    if (stError || !st) {
      await this.db.from("families").delete().eq("id", family.id); // не оставляем семью без рассказчика
      fail("создание рассказчика", stError);
    }

    let storyteller = st as Storyteller;
    if (input.photo) {
      const path = `${family.id}/${storyteller.id}.jpg`;
      const up = await this.db.storage
        .from(BUCKETS.photos)
        .upload(path, input.photo.bytes, { contentType: input.photo.contentType, upsert: true });
      if (up.error) {
        console.error("[access] фото не загрузилось:", up.error.message); // фото не критично — семья создана
      } else {
        const { data, error: e } = await this.db.from("storytellers").update({ photo_url: path }).eq("id", storyteller.id).select("*").single();
        if (!e && data) storyteller = data as Storyteller;
      }
    }
    return { family: family as Family, storyteller };
  }

  async getFamilyByToken(token: string) {
    if (!isTokenShape(token)) return null;
    const { data: family, error } = await this.db.from("families").select("*").eq("access_token", token).maybeSingle();
    if (error) fail("поиск семьи", error);
    if (!family) return null;
    const [st, stories] = await Promise.all([
      this.db.from("storytellers").select("*").eq("family_id", family.id).order("created_at", { ascending: true }),
      this.db
        .from("stories")
        .select("id, storyteller_id, question_id, block, status, parent_story_id, created_at, title")
        .eq("family_id", family.id)
        .neq("status", "skipped") // ответ-отказ — не глава и не прогресс
        .order("created_at", { ascending: true }),
    ]);
    if (st.error) fail("рассказчики семьи", st.error);
    if (stories.error) fail("истории семьи", stories.error);
    const storytellers = (st.data ?? []) as Storyteller[];
    return { family: family as Family, storytellers, storyteller: storytellers[0] ?? null, stories: (stories.data ?? []) as StorySummary[] };
  }

  async signAudioUpload(path: string) {
    const { data, error } = await this.db.storage.from(BUCKETS.audio).createSignedUploadUrl(path);
    if (error || !data) fail("ссылка на загрузку", error);
    return { signedUrl: data.signedUrl };
  }

  async photoUrl(path: string) {
    const { data, error } = await this.db.storage.from(BUCKETS.photos).createSignedUrl(path, 60 * 60);
    if (error || !data) return null;
    return data.signedUrl;
  }

  async saveConsent(storytellerId: string, audioPath: string) {
    const { data, error } = await this.db
      .from("storytellers")
      .update({ consent_audio_url: audioPath, consent_at: new Date().toISOString() })
      .eq("id", storytellerId)
      .select("*")
      .single();
    if (error || !data) fail("сохранение согласия", error);
    return data as Storyteller;
  }

  async createStory(familyId: string, input: NewStory) {
    const { data, error } = await this.db
      .from("stories")
      .insert({
        family_id: familyId,
        storyteller_id: input.storyteller_id,
        session_id: input.session_id,
        parent_story_id: input.parent_story_id,
        question_id: input.question_id,
        block: input.block,
        audio_url: input.audio_path,
        duration_sec: input.duration_sec,
        status: "uploaded",
      })
      .select("*")
      .single();
    if (error || !data) fail("создание истории", error);
    return data as Story;
  }
}

// ---------------- точка входа ----------------

const g = globalThis as { __familyMemoryStore?: MemoryFamilyStore; __interviewMemoryRepo?: MemoryInterviewRepo };

export function getFamilyStore(): FamilyStore {
  const db = getDbOrNull();
  if (db) return new SupabaseFamilyStore(db);
  // те же истории видят интервью-агент (I10) и конвейер (I2) — см. lib/interview/index.ts, lib/pipeline/index.ts
  g.__interviewMemoryRepo ??= new MemoryInterviewRepo();
  g.__familyMemoryStore ??= new MemoryFamilyStore(g.__interviewMemoryRepo.stories); // переживает hot-reload в dev
  return g.__familyMemoryStore;
}

/** Семья по токену из ссылки /f/<token>. null — ссылка неверная. */
export async function getFamilyByToken(token: string): Promise<FamilyView | null> {
  return getFamilyStore().getFamilyByToken(token);
}
