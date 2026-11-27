// Хранилище конвейера: stories, имя рассказчика, аудио из Storage, проверка ссылки семьи.
// SupabasePipelineRepo — прод (service-ключ, только сервер); MemoryPipelineRepo — тесты и локальный
// запуск без базы (делит Map историй с интервью-агентом, чтобы ответ из /api/sessions сразу обрабатывался).
import type { SupabaseClient } from "@supabase/supabase-js";
import { nameHints } from "@/lib/interview/names";
import { loadNameHints } from "@/lib/interview/names-db";
import type { BookLang, Family, FamilyEntity, Story } from "@/lib/types";
import { loadStoryTexts, mirrorRows, withStoryTexts, type StoryTextRow } from "@/lib/book/texts";
import { mergeEntities, rankEntities, type EntityDraft } from "./entities";
import { effectiveBookLangs } from "./langs";

export type PipelinePatch = Partial<
  Pick<
    Story,
    "transcript" | "followups" | "text_ru" | "title" | "quote" | "facts" | "text_ko" | "title_ko" | "quote_ko" | "status" | "error" | "duration_sec" | "kick_attempts" | "step_started_at" | "deferred_followup"
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
  /** #102: словарь семьи (family_entities). Нет реализации / нет таблицы — пустой. */
  familyEntities?(story: Story): Promise<FamilyEntity[]>;
  /** #102: дописать в словарь семьи сущности собранной главы (source='family' не перезаписывается). */
  saveEntities?(story: Story, drafts: EntityDraft[]): Promise<void>;
  /** #265: дописать древо семьи после словаря (без ИИ, идемпотентно; только при флаге family_tree). Нет — не трогаем. */
  updateTree?(story: Story): Promise<void>;
  /** #121 #124: запомнить корейское написание (только где name_ko ещё пусто — первая глава задаёт его для всей книги). */
  saveSpellings?(story: Story, spellings: { id: string; name_ko: string }[]): Promise<void>;
  /**
   * #231: языки книги семьи (с учётом флага lang_kk) и языки, на которые глава уже переведена (строки story_texts).
   * Нет реализации — как до #231: перевод на корейский, пока нет text_ko.
   */
  translationPlan?(story: Story): Promise<{ langs: BookLang[]; have: BookLang[] }>;
  /** #231: перевод главы на язык без колонок в stories (kk) — строка story_texts (origin ai). */
  saveText?(story: Story, lang: BookLang, t: TextFields): Promise<void>;
  /** #231: пересборка — убрать переводы ИИ без колонок (kk): иначе перевод старого текста остался бы в книге. */
  dropTranslations?(story: Story): Promise<void>;
}

export interface TextFields {
  title: string | null;
  text: string | null;
  quote: string | null;
}

/** Колонок у этих языков нет — их переводы живут только в story_texts. */
const COLUMN_LANGS: readonly string[] = ["ru", "ko"];

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

  /** #230: story_texts в памяти — пишется зеркалом колонок, как триггер stories_mirror_texts в базе */
  texts = new Map<string, StoryTextRow[]>();

  add(story: Story) {
    this.stories.set(story.id, structuredClone(story));
    this.texts.set(story.id, mirrorRows(story));
  }
  async getStory(id: string) {
    const s = this.stories.get(id);
    return s ? withStoryTexts(structuredClone(s), this.texts.get(id) ?? []) : null;
  }
  async updateStory(id: string, patch: PipelinePatch) {
    const s = this.stories.get(id);
    if (!s) throw new Error(`история ${id} не найдена`);
    Object.assign(s, structuredClone(patch), { updated_at: new Date().toISOString() });
    // зеркало, как триггер: язык, чьи колонки есть в патче, = колонки; все null (сброс шага) — строки языка нет
    const touched = new Set<string>();
    if ("text_ru" in patch || "title" in patch || "quote" in patch) touched.add("ru");
    if ("text_ko" in patch || "title_ko" in patch || "quote_ko" in patch) touched.add("ko");
    // #231: как триггер stories_stale_translations — новый русский текст делает переводы без колонок (kk) устаревшими
    if ("text_ru" in patch) this.texts.set(id, (this.texts.get(id) ?? []).filter((r) => COLUMN_LANGS.includes(r.lang)));
    if (touched.size) {
      const fresh = mirrorRows(s).filter((r) => touched.has(r.lang));
      this.texts.set(id, [...(this.texts.get(id) ?? []).filter((r) => !touched.has(r.lang)), ...fresh]);
    }
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
    const entities = rankEntities(this.entities.filter((e) => e.family_id === story.family_id)).map((e) => e.name_ru);
    return nameHints({ storytellerName: this.names.get(story.storyteller_id), entities });
  }
  entities: FamilyEntity[] = [];
  /** #265: тесты кладут сюда сборку древа; нет — древо не трогаем */
  updateTree?: (story: Story) => Promise<void>;
  async familyEntities(story: Story) {
    return this.entities.filter((e) => e.family_id === story.family_id).map((e) => structuredClone(e));
  }
  async saveSpellings(story: Story, spellings: { id: string; name_ko: string }[]) {
    const now = new Date().toISOString();
    for (const sp of spellings) {
      const e = this.entities.find((x) => x.id === sp.id && x.family_id === story.family_id);
      if (e && !e.name_ko?.trim()) Object.assign(e, { name_ko: sp.name_ko, updated_at: now });
    }
  }
  async saveEntities(story: Story, drafts: EntityDraft[]) {
    const { inserts, updates } = mergeEntities(this.entities.filter((e) => e.family_id === story.family_id), drafts, story.family_id, story.id);
    const now = new Date().toISOString();
    for (const u of updates) Object.assign(this.entities.find((e) => e.id === u.id)!, u.patch, { updated_at: now });
    for (const i of inserts) this.entities.push({ ...i, id: `ent-${this.entities.length + 1}`, updated_at: now });
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
  /** #231: языки книги по семьям (тесты кладут сами); нет — ru, ko. Флаг lang_kk в памяти включён (как локально). */
  bookLangs = new Map<string, BookLang[]>();
  langKkOn = true;
  async translationPlan(story: Story) {
    const langs = effectiveBookLangs({ book_langs: this.bookLangs.get(story.family_id) ?? null }, this.langKkOn);
    const have = (this.texts.get(story.id) ?? []).filter((r) => r.text != null).map((r) => r.lang);
    return { langs, have };
  }
  async saveText(story: Story, lang: BookLang, t: TextFields) {
    const rows = (this.texts.get(story.id) ?? []).filter((r) => r.lang !== lang);
    this.texts.set(story.id, [...rows, { story_id: story.id, lang, ...t }]);
  }
  async dropTranslations(story: Story) {
    this.texts.set(story.id, (this.texts.get(story.id) ?? []).filter((r) => COLUMN_LANGS.includes(r.lang)));
  }
}

// ---------------- Supabase ----------------

const MAX_AUDIO_BYTES = 19 * 1024 * 1024; // inline-аудио Gemini ограничено ~20 МБ на запрос

export class SupabasePipelineRepo implements PipelineRepo {
  constructor(
    private db: SupabaseClient,
    private bucket = "audio",
    /** #231: включён ли флаг lang_kk семье (lib/flags — server-only, поэтому снаружи). Нет — выключен. */
    private langKk: (family: Pick<Family, "id" | "labs">) => boolean = () => false,
    /** #265: древо семьи после словаря (lib/tree и lib/flags — server-only, поэтому снаружи). Нет — не трогаем. */
    private tree: ((family: Pick<Family, "id" | "labs">) => Promise<void>) | null = null,
  ) {}

  async updateTree(story: Story) {
    if (!this.tree) return;
    // "*": labs появились миграцией — до migrate запрос не должен падать
    const { data, error } = await this.db.from("families").select("*").eq("id", story.family_id).maybeSingle();
    if (error) throw new Error(`семья истории: ${error.message}`);
    await this.tree((data ?? { id: story.family_id }) as Pick<Family, "id" | "labs">);
  }

  async getStory(id: string) {
    const { data, error } = await this.db.from("stories").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`чтение истории: ${error.message}`);
    if (!data) return null;
    // #230: тексты — из story_texts, если строка есть, иначе колонки (до migrate таблицы нет — читаем колонки).
    // Запись — колонками, в story_texts их зеркалит триггер stories_mirror_texts.
    return withStoryTexts(data as Story, await loadStoryTexts(this.db, [id]));
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
  async familyEntities(story: Story) {
    const { data, error } = await this.db.from("family_entities").select("*").eq("family_id", story.family_id).limit(500);
    if (error) return []; // нет таблицы до migrate — работаем без словаря
    return (data ?? []) as FamilyEntity[];
  }
  async saveSpellings(story: Story, spellings: { id: string; name_ko: string }[]) {
    for (const sp of spellings) {
      // только пустое написание: соседняя глава могла успеть раньше — тогда её вариант и остаётся
      const { error } = await this.db.from("family_entities").update({ name_ko: sp.name_ko }).eq("id", sp.id).eq("family_id", story.family_id).is("name_ko", null);
      if (error) throw new Error(`словарь семьи: ${error.message}`);
    }
  }
  async saveEntities(story: Story, drafts: EntityDraft[]) {
    if (drafts.length === 0) return;
    const existing = await this.familyEntities(story);
    const { inserts, updates } = mergeEntities(existing, drafts, story.family_id, story.id);
    for (const u of updates) {
      const { error } = await this.db.from("family_entities").update(u.patch).eq("id", u.id);
      if (error) throw new Error(`словарь семьи: ${error.message}`);
    }
    for (const row of inserts) {
      const { error } = await this.db.from("family_entities").insert(row);
      // 23505 — ту же запись только что добавила соседняя глава: дописываем главу к ней
      if (error?.code === "23505") {
        const again = mergeEntities(await this.familyEntities(story), [{ kind: row.kind, name_ru: row.name_ru, description: row.description }], story.family_id, story.id);
        for (const u of again.updates) await this.db.from("family_entities").update(u.patch).eq("id", u.id);
      } else if (error) throw new Error(`словарь семьи: ${error.message}`);
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
  async translationPlan(story: Story) {
    // "*": book_langs / labs появились миграциями — до migrate запрос не должен падать (тогда — как сейчас)
    const { data, error } = await this.db.from("families").select("*").eq("id", story.family_id).maybeSingle();
    if (error) throw new Error(`семья истории: ${error.message}`);
    const f = (data ?? { id: story.family_id }) as Pick<Family, "id" | "labs" | "book_langs">;
    const langs = effectiveBookLangs(f, this.langKk(f));
    if (langs.every((l) => COLUMN_LANGS.includes(l))) return { langs, have: [] }; // ru / ko — по колонкам, без запроса
    const rows = await loadStoryTexts(this.db, [story.id]);
    return { langs, have: rows.filter((r) => r.text != null).map((r) => r.lang) };
  }
  async saveText(story: Story, lang: BookLang, t: TextFields) {
    const { error } = await this.db
      .from("story_texts")
      .upsert({ story_id: story.id, lang, ...t, origin: "ai", status: "ready" }, { onConflict: "story_id,lang" });
    if (error) throw new Error(`перевод ${lang}: ${error.message}`);
  }
  async dropTranslations(story: Story) {
    const { error } = await this.db.from("story_texts").delete().eq("story_id", story.id).eq("origin", "ai").not("lang", "in", "(ru,ko)");
    if (error) console.warn(`[pipeline] старые переводы ${story.id.slice(0, 8)}:`, error.message); // нет таблицы до migrate — не страшно
  }
  async interviewHold(story: Story) {
    if (!story.session_id) return false;
    const { data, error } = await this.db.from("sessions").select("ended_at, state").eq("id", story.session_id).maybeSingle();
    if (error) return false; // не знаем — не держим главу
    return holdsStory(data as { ended_at: string | null; state: Record<string, unknown> } | null, story);
  }
}
