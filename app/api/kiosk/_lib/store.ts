import "server-only";
// Данные киоска АКНЦ (I4): волонтёры, карточка старейшины (families.source = 'kiosk'), согласие на архив,
// очередь дня. Семья и рассказчик создаются тем же FamilyStore, что и у семей (I1), — фото и Storage общие;
// киоск лишь помечает семью source = 'kiosk'. Киоск видит только свои (kiosk) семьи.
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Family, KioskVolunteer, Session, StoryStatus, Storyteller } from "@/lib/types";
import { getDbOrNull } from "@/lib/db";
import { getFamilyStore, MemoryFamilyStore, type FamilyStore, type FamilyView, type NewFamily } from "@/lib/db/access";
import { MemoryInterviewRepo } from "@/lib/interview/repo";

export interface NewElder {
  name: string;
  name_ko: string | null;
  birth_year: number | null;
  birth_place: string | null;
  photo: NewFamily["photo"];
}

export interface QueueItem {
  familyId: string;
  storytellerId: string | null;
  name: string;
  birthYear: number | null;
  photoUrl: string | null;
  createdAt: string;
  consent: boolean;
  archive: boolean;
  volunteer: string | null;
  /** Последняя активность: создание карточки или начало сессии */
  lastAt: string;
  /** #92: skipped (вопрос пропущен, главы не будет) — отдельно, не входит в total и «в работе» */
  stories: { total: number; ready: number; working: number; failed: number; skipped: number };
}

export interface KioskStore {
  listVolunteers(): Promise<KioskVolunteer[]>;
  getVolunteer(id: string): Promise<KioskVolunteer | null>;
  addVolunteer(name: string): Promise<KioskVolunteer>;
  createElder(input: NewElder): Promise<{ family: Family; storyteller: Storyteller }>;
  /** Семья киоска по id (с токеном для ручек I1). Чужая (не kiosk) — null. */
  getElder(familyId: string): Promise<FamilyView | null>;
  setArchiveConsent(familyId: string, consent: boolean): Promise<boolean>;
  /** Старейшины, у которых сегодня была карточка или сессия киоска; свежие сверху. */
  queue(since: Date): Promise<QueueItem[]>;
}

export class KioskError extends Error {
  constructor(
    readonly code: "bad_request" | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "KioskError";
  }
}

export const familyNameFor = (elder: string) => `Книга семьи · ${elder}`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID_RE.test(v);

// ---------------- общие правила ----------------

type StoryRow = { family_id: string; status: StoryStatus; parent_story_id: string | null };
type SessionRow = { family_id: string; volunteer_id: string | null; started_at: string; mode?: string };

/**
 * Счётчики глав: ответы на уточнения — часть основной истории, отдельно не считаем.
 * #92: skipped (отказ / переспрос имени — главы не будет) — ни «готово», ни «в работе», ни в total.
 */
export function countStories(rows: StoryRow[]) {
  const c = { total: 0, ready: 0, working: 0, failed: 0, skipped: 0 };
  for (const s of rows) {
    if (s.parent_story_id) continue;
    if (s.status === "skipped") {
      c.skipped += 1;
      continue;
    }
    c.total += 1;
    if (s.status === "ready") c.ready += 1;
    else if (s.status === "failed") c.failed += 1;
    else c.working += 1;
  }
  return c;
}

/** Собрать очередь из строк базы (общая логика для Memory и Supabase). */
export function buildQueue(input: {
  families: Pick<Family, "id" | "archive_consent" | "created_at">[];
  storytellers: Pick<Storyteller, "id" | "family_id" | "name" | "birth_year" | "photo_url" | "consent_at" | "created_at">[];
  stories: StoryRow[];
  sessions: SessionRow[];
  volunteers: Pick<KioskVolunteer, "id" | "name">[];
  photoUrls?: Map<string, string | null>;
}): QueueItem[] {
  const vol = new Map(input.volunteers.map((v) => [v.id, v.name]));
  return input.families
    .map((f) => {
      const st = input.storytellers.filter((s) => s.family_id === f.id).sort((a, b) => a.created_at.localeCompare(b.created_at))[0] ?? null;
      const sess = input.sessions.filter((s) => s.family_id === f.id).sort((a, b) => b.started_at.localeCompare(a.started_at));
      const lastAt = [f.created_at, sess[0]?.started_at].filter((x): x is string => Boolean(x)).sort().at(-1)!;
      const volunteerId = sess.find((s) => s.volunteer_id)?.volunteer_id ?? null;
      return {
        familyId: f.id,
        storytellerId: st?.id ?? null,
        name: st?.name ?? "Без имени",
        birthYear: st?.birth_year ?? null,
        photoUrl: st ? (input.photoUrls?.get(st.id) ?? null) : null,
        createdAt: f.created_at,
        consent: Boolean(st?.consent_at),
        archive: f.archive_consent,
        volunteer: volunteerId ? (vol.get(volunteerId) ?? null) : null,
        lastAt,
        stories: countStories(input.stories.filter((s) => s.family_id === f.id)),
      };
    })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

// ---------------- Memory ----------------

export class MemoryKioskStore implements KioskStore {
  volunteers = new Map<string, KioskVolunteer>();

  constructor(
    readonly families: MemoryFamilyStore,
    /** Сессии и истории интервью-агента (локальный режим) — чтобы агент узнал новую семью */
    readonly interview?: MemoryInterviewRepo,
  ) {}

  async listVolunteers() {
    return [...this.volunteers.values()].filter((v) => v.active).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }

  async getVolunteer(id: string) {
    const v = this.volunteers.get(id);
    return v && v.active ? structuredClone(v) : null;
  }

  async addVolunteer(name: string) {
    const existing = [...this.volunteers.values()].find((v) => v.active && v.name.toLowerCase() === name.toLowerCase());
    if (existing) return structuredClone(existing);
    const v: KioskVolunteer = { id: randomUUID(), name, active: true, created_at: new Date().toISOString() };
    this.volunteers.set(v.id, v);
    return structuredClone(v);
  }

  async createElder(input: NewElder) {
    const res = await this.families.createFamily(toNewFamily(input));
    const f = this.families.families.get(res.family.id)!;
    f.source = "kiosk";
    this.interview?.addFamily(f.id, f.access_token, [res.storyteller.id]);
    return { family: structuredClone(f), storyteller: res.storyteller };
  }

  private kioskFamily(id: string) {
    const f = this.families.families.get(id);
    return f && f.source === "kiosk" ? f : null;
  }

  async getElder(familyId: string) {
    const f = this.kioskFamily(familyId);
    return f ? this.families.getFamilyByToken(f.access_token) : null;
  }

  async setArchiveConsent(familyId: string, consent: boolean) {
    const f = this.kioskFamily(familyId);
    if (!f) return false;
    f.archive_consent = consent;
    f.updated_at = new Date().toISOString();
    return true;
  }

  async queue(since: Date) {
    const from = since.toISOString();
    const sessions = [...(this.interview?.sessions.values() ?? [])].filter((s) => s.mode === "kiosk");
    const ids = new Set<string>();
    for (const f of this.families.families.values()) if (f.source === "kiosk" && f.created_at >= from) ids.add(f.id);
    for (const s of sessions) if (s.started_at >= from) ids.add(s.family_id);
    const families = [...ids].map((id) => this.kioskFamily(id)).filter((f): f is Family => Boolean(f));
    return buildQueue({
      families,
      storytellers: [...this.families.storytellers.values()].filter((s) => ids.has(s.family_id)),
      stories: [...this.families.stories.values()].filter((s) => ids.has(s.family_id)),
      sessions: sessions.filter((s: Session) => ids.has(s.family_id)),
      volunteers: [...this.volunteers.values()],
    });
  }
}

function toNewFamily(input: NewElder): NewFamily {
  return {
    name: familyNameFor(input.name),
    gift_date: null,
    contact: null,
    storyteller: { name: input.name, name_ko: input.name_ko, birth_year: input.birth_year, birth_place: input.birth_place },
    photo: input.photo,
  };
}

// ---------------- Supabase ----------------

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`${what}: ${error?.message ?? "нет данных"}`);
}

export class SupabaseKioskStore implements KioskStore {
  constructor(
    private db: SupabaseClient,
    private families: FamilyStore,
  ) {}

  async listVolunteers() {
    const { data, error } = await this.db.from("kiosk_volunteers").select("*").eq("active", true).order("name");
    if (error) fail("волонтёры", error);
    return (data ?? []) as KioskVolunteer[];
  }

  async getVolunteer(id: string) {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db.from("kiosk_volunteers").select("*").eq("id", id).eq("active", true).maybeSingle();
    if (error) fail("волонтёр", error);
    return (data as KioskVolunteer | null) ?? null;
  }

  async addVolunteer(name: string) {
    const { data: found } = await this.db.from("kiosk_volunteers").select("*").eq("active", true).ilike("name", name).limit(1);
    if (found && found[0]) return found[0] as KioskVolunteer;
    const { data, error } = await this.db.from("kiosk_volunteers").insert({ name }).select("*").single();
    if (error || !data) fail("новый волонтёр", error);
    return data as KioskVolunteer;
  }

  async createElder(input: NewElder) {
    const res = await this.families.createFamily(toNewFamily(input));
    const { data, error } = await this.db.from("families").update({ source: "kiosk" }).eq("id", res.family.id).select("*").single();
    if (error || !data) {
      await this.db.from("families").delete().eq("id", res.family.id); // не оставляем «семейную» карточку из киоска
      fail("пометка семьи киоска", error);
    }
    return { family: data as Family, storyteller: res.storyteller };
  }

  async getElder(familyId: string) {
    if (!isUuid(familyId)) return null;
    const { data, error } = await this.db.from("families").select("access_token").eq("id", familyId).eq("source", "kiosk").maybeSingle();
    if (error) fail("семья киоска", error);
    return data ? this.families.getFamilyByToken((data as { access_token: string }).access_token) : null;
  }

  async setArchiveConsent(familyId: string, consent: boolean) {
    if (!isUuid(familyId)) return false;
    const { data, error } = await this.db
      .from("families")
      .update({ archive_consent: consent })
      .eq("id", familyId)
      .eq("source", "kiosk")
      .select("id");
    if (error) fail("согласие на архив", error);
    return (data ?? []).length > 0;
  }

  async queue(since: Date) {
    const from = since.toISOString();
    const [created, todaySessions] = await Promise.all([
      this.db.from("families").select("id").eq("source", "kiosk").gte("created_at", from),
      this.db.from("sessions").select("family_id").eq("mode", "kiosk").gte("started_at", from),
    ]);
    if (created.error) fail("очередь: семьи", created.error);
    if (todaySessions.error) fail("очередь: сессии", todaySessions.error);
    const ids = [...new Set([...(created.data ?? []).map((r) => r.id as string), ...(todaySessions.data ?? []).map((r) => r.family_id as string)])];
    if (ids.length === 0) return [];

    const [fam, st, stories, sessions, volunteers] = await Promise.all([
      this.db.from("families").select("id, archive_consent, created_at").in("id", ids).eq("source", "kiosk"),
      this.db.from("storytellers").select("id, family_id, name, birth_year, photo_url, consent_at, created_at").in("family_id", ids),
      this.db.from("stories").select("family_id, status, parent_story_id").in("family_id", ids),
      this.db.from("sessions").select("family_id, volunteer_id, started_at").in("family_id", ids).eq("mode", "kiosk"),
      this.db.from("kiosk_volunteers").select("id, name"),
    ]);
    for (const [what, r] of [["семьи", fam], ["рассказчики", st], ["истории", stories], ["сессии", sessions], ["волонтёры", volunteers]] as const) {
      if (r.error) fail(`очередь: ${what}`, r.error);
    }
    const storytellers = (st.data ?? []) as QueueStoryteller[];
    const photoUrls = new Map<string, string | null>();
    await Promise.all(
      storytellers.filter((s) => s.photo_url).map(async (s) => photoUrls.set(s.id, await this.families.photoUrl(s.photo_url!))),
    );
    return buildQueue({
      families: (fam.data ?? []) as Pick<Family, "id" | "archive_consent" | "created_at">[],
      storytellers,
      stories: (stories.data ?? []) as StoryRow[],
      sessions: (sessions.data ?? []) as SessionRow[],
      volunteers: (volunteers.data ?? []) as Pick<KioskVolunteer, "id" | "name">[],
      photoUrls,
    });
  }
}

type QueueStoryteller = Pick<Storyteller, "id" | "family_id" | "name" | "birth_year" | "photo_url" | "consent_at" | "created_at">;

// ---------------- точка входа ----------------

const g = globalThis as { __kioskMemoryStore?: MemoryKioskStore; __interviewMemoryRepo?: MemoryInterviewRepo };

export function getKioskStore(): KioskStore {
  const families = getFamilyStore();
  const db = getDbOrNull();
  if (db) return new SupabaseKioskStore(db, families);
  // локально без базы: те же карты, что у семьи (I1), интервью-агента (I10) и конвейера (I2)
  g.__kioskMemoryStore ??= new MemoryKioskStore(families as MemoryFamilyStore, g.__interviewMemoryRepo);
  return g.__kioskMemoryStore;
}
