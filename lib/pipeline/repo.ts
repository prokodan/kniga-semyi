// Хранилище конвейера: stories, имя рассказчика, аудио из Storage, проверка ссылки семьи.
// SupabasePipelineRepo — прод (service-ключ, только сервер); MemoryPipelineRepo — тесты и локальный
// запуск без базы (делит Map историй с интервью-агентом, чтобы ответ из /api/sessions сразу обрабатывался).
import type { SupabaseClient } from "@supabase/supabase-js";
import { nameHints } from "@/lib/interview/names";
import { loadNameHints } from "@/lib/interview/names-db";
import type { Story } from "@/lib/types";

export type PipelinePatch = Partial<
  Pick<
    Story,
    "transcript" | "followups" | "text_ru" | "title" | "quote" | "facts" | "text_ko" | "title_ko" | "quote_ko" | "status" | "error" | "duration_sec" | "kick_attempts" | "step_started_at"
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
  /**
   * Интервью ещё на вопросе этой истории (может задать уточнение) — главу собирать рано (пункт 4).
   * Нет реализации — не держим.
   */
  interviewHold?(story: Story): Promise<boolean>;
  /** Имена и места для расшифровки и редактуры (пункт 5). Нет реализации — без подсказок. */
  nameHints?(story: Story): Promise<string[]>;
  /** #98: записи-уточнения этой истории (parent_story_id = id). Нет реализации — только то, что приклеило интервью. */
  children?(story: Story): Promise<Pick<Story, "id" | "transcript" | "status" | "created_at">[]>;
  /** #98: более ранние основные истории того же рассказчика (не пропущенные) — чтобы не повторять рассказ в двух главах. */
  earlier?(story: Story): Promise<Pick<Story, "id" | "transcript" | "followups" | "created_at">[]>;
}

/** Более ранние основные истории рассказчика: не уточнения, не пропуски, создана раньше. */
export function isEarlier(s: Pick<Story, "id" | "storyteller_id" | "parent_story_id" | "status" | "created_at">, story: Story): boolean {
  return s.id !== story.id && s.storyteller_id === story.storyteller_id && !s.parent_story_id && s.status !== "skipped" && s.created_at < story.created_at;
}

/** Сессия ещё на вопросе этой истории: не завершена, текущий вопрос тот же и он не закрыт. */
export function holdsStory(
  session: { ended_at?: string | null; state?: Record<string, unknown> | null } | null,
  story: Pick<Story, "question_id">,
): boolean {
  if (!session || session.ended_at || !story.question_id) return false;
  const st = (session.state ?? {}) as { finished?: boolean; current_question_id?: string; answered_question_ids?: string[]; skipped_question_ids?: string[] };
  if (st.finished || st.current_question_id !== story.question_id) return false;
  return !(st.answered_question_ids ?? []).includes(story.question_id) && !(st.skipped_question_ids ?? []).includes(story.question_id);
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
  /** Сессии интервью (локальный режим — общая карта с интервью-агентом; тесты кладут сами) */
  sessions: Map<string, { ended_at?: string | null; state?: Record<string, unknown> | null }> | null = null;

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
  async nameHints(story: Story) {
    return nameHints({ storytellerName: this.names.get(story.storyteller_id) });
  }
  async children(story: Story) {
    return [...this.stories.values()].filter((s) => s.parent_story_id === story.id).map((s) => structuredClone(s));
  }
  async earlier(story: Story) {
    return [...this.stories.values()].filter((s) => isEarlier(s, story)).map((s) => structuredClone(s));
  }
  async interviewHold(story: Story) {
    return story.session_id && this.sessions ? holdsStory(this.sessions.get(story.session_id) ?? null, story) : false;
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
  async nameHints(story: Story) {
    try {
      return await loadNameHints(this.db, story.storyteller_id);
    } catch {
      return nameHints({}); // без карточки — хотя бы словарь
    }
  }
  async children(story: Story) {
    const { data, error } = await this.db.from("stories").select("id, transcript, status, created_at").eq("parent_story_id", story.id);
    if (error) throw new Error(`уточнения истории: ${error.message}`);
    return (data ?? []) as Pick<Story, "id" | "transcript" | "status" | "created_at">[];
  }
  async earlier(story: Story) {
    const { data, error } = await this.db
      .from("stories")
      .select("id, transcript, followups, created_at")
      .eq("storyteller_id", story.storyteller_id)
      .is("parent_story_id", null)
      .neq("status", "skipped")
      .neq("id", story.id)
      .lt("created_at", story.created_at)
      .order("created_at", { ascending: true })
      .limit(80);
    if (error) throw new Error(`прошлые истории: ${error.message}`);
    return (data ?? []) as Pick<Story, "id" | "transcript" | "followups" | "created_at">[];
  }
  async interviewHold(story: Story) {
    if (!story.session_id) return false;
    const { data, error } = await this.db.from("sessions").select("ended_at, state").eq("id", story.session_id).maybeSingle();
    if (error) return false; // не знаем — не держим главу
    return holdsStory(data as { ended_at: string | null; state: Record<string, unknown> } | null, story);
  }
}
