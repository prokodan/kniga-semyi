// Кабинет АКНЦ (I9): чистая сводка из строк базы — счётчики, список семей, архив, волонтёры.
// Без next/* и без базы — проверяется тестами. Источник строк — ./source.ts (Supabase или память).
import type { BookStatus, Family, KioskVolunteer, SessionMode, Story, Storyteller } from "@/lib/types";

export type FamilyRow = Pick<Family, "id" | "name" | "source" | "archive_consent" | "is_demo" | "created_at">;
export type StorytellerRow = Pick<Storyteller, "id" | "family_id" | "name" | "birth_year" | "consent_at" | "created_at">;
export type StoryRow = Pick<Story, "family_id" | "status" | "parent_story_id" | "duration_sec" | "created_at">;
export type BookRow = { family_id: string; status: BookStatus; built_at: string | null; created_at: string };
export type SessionRow = { family_id: string; volunteer_id: string | null; mode: SessionMode; started_at: string };

export interface CenterRows {
  families: FamilyRow[];
  storytellers: StorytellerRow[];
  stories: StoryRow[];
  books: BookRow[];
  sessions: SessionRow[];
  volunteers: KioskVolunteer[];
}

/** Статус книги семьи: последняя строка books или «нет книги». */
export type FamilyBookStatus = BookStatus | "none";
export const BOOK_STATUSES: readonly FamilyBookStatus[] = ["none", "draft", "building", "ready", "failed"];

export interface Counter {
  today: number;
  total: number;
}

export interface CenterCounters {
  families: Counter;
  kioskFamilies: Counter;
  elders: Counter;
  /** Старейшины, давшие голосовое согласие */
  consented: number;
  stories: Counter;
  readyStories: Counter;
  /** Минуты голоса: сумма duration_sec всех записей, включая ответы на уточнения */
  minutes: Counter;
  books: Record<FamilyBookStatus, number>;
  booksBuiltToday: number;
  archive: number;
}

export interface CenterFamily {
  id: string;
  name: string;
  source: SessionMode;
  isDemo: boolean;
  archive: boolean;
  createdAt: string;
  storytellers: { name: string; birthYear: number | null; consent: boolean }[];
  stories: { total: number; ready: number; working: number; failed: number };
  minutes: number;
  book: FamilyBookStatus;
  lastAt: string;
}

export interface CenterVolunteer extends KioskVolunteer {
  sessions: number;
  sessionsToday: number;
}

export interface CenterFilter {
  /** Скрыть демо-семьи (is_demo) — и из счётчиков, и из списков */
  hideDemo?: boolean;
}

const minutes = (sec: number) => Math.round((sec / 60) * 10) / 10;

/** Оставить строки только недемо-семей (если нужно). */
export function applyFilter(rows: CenterRows, filter: CenterFilter = {}): CenterRows {
  if (!filter.hideDemo) return rows;
  const keep = new Set(rows.families.filter((f) => !f.is_demo).map((f) => f.id));
  const own = <T extends { family_id: string }>(xs: T[]) => xs.filter((x) => keep.has(x.family_id));
  return {
    families: rows.families.filter((f) => keep.has(f.id)),
    storytellers: own(rows.storytellers),
    stories: own(rows.stories),
    books: own(rows.books),
    sessions: own(rows.sessions),
    volunteers: rows.volunteers,
  };
}

/** Последняя книга каждой семьи. */
function latestBooks(books: BookRow[]): Map<string, BookRow> {
  const m = new Map<string, BookRow>();
  for (const b of books) {
    const cur = m.get(b.family_id);
    if (!cur || b.created_at > cur.created_at) m.set(b.family_id, b);
  }
  return m;
}

export function buildCounters(rows: CenterRows, since: Date): CenterCounters {
  const from = since.toISOString();
  const isToday = (iso: string | null | undefined) => Boolean(iso && iso >= from);
  const count = <T>(xs: T[], at: (x: T) => string): Counter => ({ total: xs.length, today: xs.filter((x) => isToday(at(x))).length });

  const main = rows.stories.filter((s) => !s.parent_story_id);
  const ready = main.filter((s) => s.status === "ready");
  const sec = (xs: StoryRow[]) => xs.reduce((sum, s) => sum + (Number(s.duration_sec) || 0), 0);

  const books = Object.fromEntries(BOOK_STATUSES.map((s) => [s, 0])) as Record<FamilyBookStatus, number>;
  const latest = latestBooks(rows.books);
  for (const f of rows.families) books[latest.get(f.id)?.status ?? "none"] += 1;

  return {
    families: count(rows.families, (f) => f.created_at),
    kioskFamilies: count(
      rows.families.filter((f) => f.source === "kiosk"),
      (f) => f.created_at,
    ),
    elders: count(rows.storytellers, (s) => s.created_at),
    consented: rows.storytellers.filter((s) => s.consent_at).length,
    stories: count(main, (s) => s.created_at),
    readyStories: count(ready, (s) => s.created_at),
    minutes: { total: minutes(sec(rows.stories)), today: minutes(sec(rows.stories.filter((s) => isToday(s.created_at)))) },
    books,
    booksBuiltToday: [...latest.values()].filter((b) => b.status === "ready" && isToday(b.built_at)).length,
    archive: rows.families.filter((f) => f.archive_consent).length,
  };
}

export function buildFamilies(rows: CenterRows): CenterFamily[] {
  const latest = latestBooks(rows.books);
  return rows.families
    .map((f): CenterFamily => {
      const st = rows.storytellers.filter((s) => s.family_id === f.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
      const all = rows.stories.filter((s) => s.family_id === f.id);
      const c = { total: 0, ready: 0, working: 0, failed: 0 };
      for (const s of all) {
        if (s.parent_story_id) continue; // ответ на уточнение — часть основной истории
        c.total += 1;
        if (s.status === "ready") c.ready += 1;
        else if (s.status === "failed") c.failed += 1;
        else c.working += 1;
      }
      const sessions = rows.sessions.filter((s) => s.family_id === f.id).map((s) => s.started_at);
      const lastAt = [f.created_at, ...all.map((s) => s.created_at), ...sessions].sort().at(-1)!;
      return {
        id: f.id,
        name: f.name,
        source: f.source,
        isDemo: f.is_demo,
        archive: f.archive_consent,
        createdAt: f.created_at,
        storytellers: st.map((s) => ({ name: s.name, birthYear: s.birth_year, consent: Boolean(s.consent_at) })),
        stories: c,
        minutes: minutes(all.reduce((sum, s) => sum + (Number(s.duration_sec) || 0), 0)),
        book: latest.get(f.id)?.status ?? "none",
        lastAt,
      };
    })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

export type FamilyView = "all" | "kiosk" | "family" | "archive";

/** Раздел «Архив АКНЦ» — только семьи с archive_consent = true. */
export function filterFamilies(list: CenterFamily[], view: FamilyView): CenterFamily[] {
  if (view === "archive") return list.filter((f) => f.archive);
  if (view === "kiosk" || view === "family") return list.filter((f) => f.source === view);
  return list;
}

export function buildVolunteers(rows: CenterRows, since: Date): CenterVolunteer[] {
  const from = since.toISOString();
  return rows.volunteers
    .map((v) => {
      const own = rows.sessions.filter((s) => s.volunteer_id === v.id);
      return { ...v, sessions: own.length, sessionsToday: own.filter((s) => s.started_at >= from).length };
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "ru"));
}

export const BOOK_LABEL: Record<FamilyBookStatus, string> = {
  none: "нет книги",
  draft: "черновик",
  building: "собирается",
  ready: "готова",
  failed: "ошибка сборки",
};
