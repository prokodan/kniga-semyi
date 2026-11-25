// Хранилище интервью: sessions и stories. SupabaseInterviewRepo — прод (service-ключ, только сервер),
// MemoryInterviewRepo — тесты, симулятор (I15) и локальный запуск без базы.
import type { SupabaseClient } from "@supabase/supabase-js";
import { nameHints } from "./names";
import { loadNameHints } from "./names-db";
import type { Session, SessionMode, Story } from "@/lib/types";
import type { SessionState } from "./policy";

export type StoryDraft = Pick<Story, "family_id" | "storyteller_id" | "session_id" | "question_id" | "block" | "transcript">;
export type StoryPatch = Partial<Pick<Story, "question_id" | "block" | "followups" | "transcript" | "parent_story_id" | "status">>;

export interface InterviewRepo {
  createSession(s: { family_id: string; storyteller_id: string; mode: SessionMode; volunteer_id: string | null; state: SessionState }): Promise<Session>;
  getSession(id: string): Promise<Session | null>;
  saveState(id: string, state: SessionState, ended?: boolean): Promise<void>;
  getStory(id: string): Promise<Story | null>;
  /** #108: вопросы, на которые рассказчик уже ответил в любых сессиях (основные рассказы, кроме skipped) */
  answeredQuestionIds?(storytellerId: string): Promise<string[]>;
  createStory(d: StoryDraft): Promise<Story>;
  updateStory(id: string, patch: StoryPatch): Promise<void>;
  /** Рассказчик принадлежит семье */
  storytellerBelongs(familyId: string, storytellerId: string): Promise<boolean>;
  /** Токен из ссылки семьи совпадает (families.access_token) */
  checkFamilyToken(familyId: string, token: string): Promise<boolean>;
  /** Имя рассказчика для фразы-связки (необязательно) */
  storytellerName?(storytellerId: string): Promise<string>;
  /** Имена и места семьи + словарь (пункт 5) — для переспроса неуверенно распознанного имени */
  nameHints?(storytellerId: string): Promise<string[]>;
  /** #99: прошлые ответы рассказчика (основной ответ + уточнения, по времени) — не спрашивать уже рассказанное */
  earlierAnswers?(storytellerId: string): Promise<string[]>;
}

/** Ответ истории одной строкой: расшифровка + ответы на уточнения. */
function storyAnswer(s: Pick<Story, "transcript" | "followups">): string {
  return [s.transcript ?? "", ...(s.followups ?? []).map((f) => f.answer)].filter((p) => p.trim()).join(" ");
}

/** Сколько последних историй смотреть для «уже отвечено». */
const EARLIER_STORIES = 30;

// ---------------- Memory ----------------

export class MemoryInterviewRepo implements InterviewRepo {
  sessions = new Map<string, Session>();
  stories = new Map<string, Story>();
  /** familyId → { token, storytellers } — тесты и локальный режим заводят семьи сами */
  families = new Map<string, { token: string; storytellers: Set<string> }>();
  private seq = 0;

  private id(prefix: string) {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(6, "0")}`;
  }

  addFamily(familyId: string, token: string, storytellerIds: string[]) {
    this.families.set(familyId, { token, storytellers: new Set(storytellerIds) });
  }

  async createSession(s: Parameters<InterviewRepo["createSession"]>[0]) {
    const session: Session = { id: this.id("session"), ...s, started_at: new Date().toISOString(), ended_at: null };
    this.sessions.set(session.id, structuredClone(session));
    return structuredClone(session);
  }
  async getSession(id: string) {
    const s = this.sessions.get(id);
    return s ? structuredClone(s) : null;
  }
  async saveState(id: string, state: SessionState, ended = false) {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`сессия ${id} не найдена`);
    s.state = structuredClone(state);
    if (ended) s.ended_at = new Date().toISOString();
  }
  async getStory(id: string) {
    const s = this.stories.get(id);
    return s ? structuredClone(s) : null;
  }
  async createStory(d: StoryDraft) {
    const now = new Date().toISOString();
    const story: Story = {
      id: this.id("story"),
      parent_story_id: null,
      ...d,
      audio_url: null,
      duration_sec: null,
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
  async updateStory(id: string, patch: StoryPatch) {
    const s = this.stories.get(id);
    if (!s) throw new Error(`история ${id} не найдена`);
    Object.assign(s, structuredClone(patch), { updated_at: new Date().toISOString() });
  }
  async storytellerBelongs(familyId: string, storytellerId: string) {
    const f = this.families.get(familyId);
    return f ? f.storytellers.has(storytellerId) : true; // без заведённой семьи — локальный режим
  }
  async checkFamilyToken(familyId: string, token: string) {
    const f = this.families.get(familyId);
    return f ? f.token === token : true;
  }
  names = new Map<string, string>();
  async storytellerName(storytellerId: string) {
    return this.names.get(storytellerId) ?? "";
  }
  async nameHints(storytellerId: string) {
    return nameHints({ storytellerName: this.names.get(storytellerId) });
  }
  async answeredQuestionIds(storytellerId: string) {
    return [...this.stories.values()]
      .filter((s) => s.storyteller_id === storytellerId && s.status !== "skipped" && !s.parent_story_id && s.question_id)
      .map((s) => s.question_id!);
  }
  async earlierAnswers(storytellerId: string) {
    return [...this.stories.values()]
      .filter((s) => s.storyteller_id === storytellerId && s.status !== "skipped" && !s.parent_story_id)
      .slice(-EARLIER_STORIES)
      .map(storyAnswer)
      .filter(Boolean);
  }
}

// ---------------- Supabase ----------------

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`${what}: ${error?.message ?? "нет данных"}`);
}

export class SupabaseInterviewRepo implements InterviewRepo {
  constructor(private db: SupabaseClient) {}

  async createSession(s: Parameters<InterviewRepo["createSession"]>[0]) {
    const { data, error } = await this.db.from("sessions").insert(s).select("*").single();
    if (error || !data) fail("создание сессии", error);
    return data as Session;
  }
  async getSession(id: string) {
    const { data, error } = await this.db.from("sessions").select("*").eq("id", id).maybeSingle();
    if (error) fail("чтение сессии", error);
    return (data as Session | null) ?? null;
  }
  async saveState(id: string, state: SessionState, ended = false) {
    const patch: Record<string, unknown> = { state };
    if (ended) patch.ended_at = new Date().toISOString();
    const { error } = await this.db.from("sessions").update(patch).eq("id", id);
    if (error) fail("сохранение состояния", error);
  }
  async getStory(id: string) {
    const { data, error } = await this.db.from("stories").select("*").eq("id", id).maybeSingle();
    if (error) fail("чтение истории", error);
    return (data as Story | null) ?? null;
  }
  async createStory(d: StoryDraft) {
    const { data, error } = await this.db.from("stories").insert(d).select("*").single();
    if (error || !data) fail("создание истории", error);
    return data as Story;
  }
  async updateStory(id: string, patch: StoryPatch) {
    const { error } = await this.db
      .from("stories")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) fail("обновление истории", error);
  }
  async storytellerBelongs(familyId: string, storytellerId: string) {
    const { data, error } = await this.db
      .from("storytellers")
      .select("id")
      .eq("id", storytellerId)
      .eq("family_id", familyId)
      .maybeSingle();
    if (error) fail("проверка рассказчика", error);
    return Boolean(data);
  }
  async checkFamilyToken(familyId: string, token: string) {
    const { data, error } = await this.db.from("families").select("id").eq("id", familyId).eq("access_token", token).maybeSingle();
    if (error) fail("проверка ссылки семьи", error);
    return Boolean(data);
  }
  async storytellerName(storytellerId: string) {
    const { data } = await this.db.from("storytellers").select("name").eq("id", storytellerId).maybeSingle();
    return (data as { name?: string } | null)?.name ?? "";
  }
  async nameHints(storytellerId: string) {
    try {
      return await loadNameHints(this.db, storytellerId);
    } catch {
      return nameHints({});
    }
  }
  async answeredQuestionIds(storytellerId: string) {
    const { data, error } = await this.db
      .from("stories")
      .select("question_id")
      .eq("storyteller_id", storytellerId)
      .is("parent_story_id", null)
      .neq("status", "skipped")
      .not("question_id", "is", null);
    if (error) fail("отвеченные вопросы", error);
    return ((data ?? []) as { question_id: string }[]).map((r) => r.question_id);
  }
  async earlierAnswers(storytellerId: string) {
    const { data, error } = await this.db
      .from("stories")
      .select("transcript, followups, created_at")
      .eq("storyteller_id", storytellerId)
      .is("parent_story_id", null)
      .neq("status", "skipped")
      .order("created_at", { ascending: false })
      .limit(EARLIER_STORIES);
    if (error) fail("прошлые ответы", error);
    return ((data ?? []) as Pick<Story, "transcript" | "followups">[]).reverse().map(storyAnswer).filter(Boolean);
  }
}

