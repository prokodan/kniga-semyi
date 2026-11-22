// Хранилище конвейера: stories, имя рассказчика, аудио из Storage, проверка ссылки семьи.
// SupabasePipelineRepo — прод (service-ключ, только сервер); MemoryPipelineRepo — тесты и локальный
// запуск без базы (делит Map историй с интервью-агентом, чтобы ответ из /api/sessions сразу обрабатывался).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Story } from "@/lib/types";

export type PipelinePatch = Partial<
  Pick<
    Story,
    "transcript" | "text_ru" | "title" | "quote" | "facts" | "text_ko" | "title_ko" | "quote_ko" | "status" | "error" | "duration_sec" | "kick_attempts" | "step_started_at"
  >
>;

export interface AudioFile {
  base64: string;
  mimeType: string;
  bytes: number;
}

export interface PipelineRepo {
  getStory(id: string): Promise<Story | null>;
  updateStory(id: string, patch: PipelinePatch): Promise<void>;
  storytellerName(storytellerId: string): Promise<string>;
  /** Аудио истории: путь в бакете audio (`<family>/<story>.webm`, можно с префиксом `audio/`) или https-ссылка */
  loadAudio(audioUrl: string): Promise<AudioFile>;
  checkFamilyToken(familyId: string, token: string): Promise<boolean>;
}

const EXT_MIME: Record<string, string> = {
  webm: "audio/webm",
  weba: "audio/webm",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/aac",
  mp3: "audio/mpeg",
  mpeg: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
};

/** MIME без параметров (`audio/webm;codecs=opus` → `audio/webm`); если тип неизвестен — по расширению. */
export function audioMime(type: string | undefined | null, path: string): string {
  const base = (type ?? "").split(";")[0]!.trim().toLowerCase();
  if (base.startsWith("audio/") || base === "video/mp4" || base === "video/webm") return base.replace("video/", "audio/");
  const ext = path.split("?")[0]!.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MIME[ext] ?? "audio/webm";
}

// ---------------- Memory ----------------

export class MemoryPipelineRepo implements PipelineRepo {
  /** Аудио по пути — тесты кладут сюда байты */
  audio = new Map<string, { data: Buffer; mimeType?: string }>();
  names = new Map<string, string>();
  tokens = new Map<string, string>();

  constructor(readonly stories: Map<string, Story> = new Map()) {}

  add(story: Story) {
    this.stories.set(story.id, structuredClone(story));
  }
  async getStory(id: string) {
    const s = this.stories.get(id);
    return s ? structuredClone(s) : null;
  }
  async updateStory(id: string, patch: PipelinePatch) {
    const s = this.stories.get(id);
    if (!s) throw new Error(`история ${id} не найдена`);
    Object.assign(s, structuredClone(patch), { updated_at: new Date().toISOString() });
  }
  async storytellerName(storytellerId: string) {
    return this.names.get(storytellerId) ?? "";
  }
  async loadAudio(audioUrl: string): Promise<AudioFile> {
    const a = this.audio.get(audioUrl);
    if (!a) throw new Error("аудио не найдено в хранилище");
    return { base64: a.data.toString("base64"), mimeType: audioMime(a.mimeType, audioUrl), bytes: a.data.length };
  }
  async checkFamilyToken(familyId: string, token: string) {
    const t = this.tokens.get(familyId);
    return t === undefined ? true : t === token; // без заведённой семьи — локальный режим
  }
}

// ---------------- Supabase ----------------

const MAX_AUDIO_BYTES = 19 * 1024 * 1024; // inline-аудио Gemini ограничено ~20 МБ на запрос

export class SupabasePipelineRepo implements PipelineRepo {
  constructor(
    private db: SupabaseClient,
    private bucket = "audio",
  ) {}

  async getStory(id: string) {
    const { data, error } = await this.db.from("stories").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`чтение истории: ${error.message}`);
    return (data as Story | null) ?? null;
  }
  async updateStory(id: string, patch: PipelinePatch) {
    const { error } = await this.db
      .from("stories")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(`обновление истории: ${error.message}`);
  }
  async storytellerName(storytellerId: string) {
    const { data } = await this.db.from("storytellers").select("name").eq("id", storytellerId).maybeSingle();
    return (data as { name?: string } | null)?.name ?? "";
  }
  async loadAudio(audioUrl: string): Promise<AudioFile> {
    let blob: Blob;
    if (/^https?:\/\//i.test(audioUrl)) {
      const res = await fetch(audioUrl);
      if (!res.ok) throw new Error(`аудио по ссылке: HTTP ${res.status}`);
      blob = await res.blob();
    } else {
      const path = audioUrl.replace(/^\/+/, "").replace(new RegExp(`^${this.bucket}/`), "");
      const { data, error } = await this.db.storage.from(this.bucket).download(path);
      if (error || !data) throw new Error(`аудио из хранилища: ${error?.message ?? "файл не найден"}`);
      blob = data;
    }
    if (blob.size === 0) throw new Error("аудиофайл пустой");
    if (blob.size > MAX_AUDIO_BYTES) throw new Error("аудиофайл больше 19 МБ — запишите рассказ частями");
    const buf = Buffer.from(await blob.arrayBuffer());
    return { base64: buf.toString("base64"), mimeType: audioMime(blob.type, audioUrl), bytes: buf.length };
  }
  async checkFamilyToken(familyId: string, token: string) {
    const { data, error } = await this.db.from("families").select("id").eq("id", familyId).eq("access_token", token).maybeSingle();
    if (error) throw new Error(`проверка ссылки семьи: ${error.message}`);
    return Boolean(data);
  }
}
