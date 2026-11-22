import "server-only";
// Кабинет АКНЦ (I9): строки для сводки и правка волонтёров. Supabase (service-ключ) или память сервера
// в локальном режиме — те же карты, что у семьи (I1), киоска (I4), интервью (I10) и книги (I5).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Book, KioskVolunteer, Session } from "@/lib/types";
import { getDbOrNull } from "@/lib/db";
import { getFamilyStore, type MemoryFamilyStore } from "@/lib/db/access";
import { getKioskStore, isUuid, type MemoryKioskStore } from "@/app/api/kiosk/_lib/store";
import type { BookRow, CenterRows, SessionRow } from "./stats";

export class CenterError extends Error {
  constructor(
    readonly code: "bad_request" | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "CenterError";
  }
}

export interface CenterSource {
  readonly kind: "supabase" | "memory";
  rows(): Promise<CenterRows>;
  addVolunteer(name: string): Promise<KioskVolunteer>;
  setVolunteerActive(id: string, active: boolean): Promise<KioskVolunteer>;
}

/** PostgREST по умолчанию отдаёт до 1000 строк — для MLP с запасом берём до 10 000. */
const MAX = 9_999;

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`${what}: ${error?.message ?? "нет данных"}`);
}

class SupabaseCenterSource implements CenterSource {
  readonly kind = "supabase" as const;
  constructor(private db: SupabaseClient) {}

  async rows(): Promise<CenterRows> {
    const [families, storytellers, stories, books, sessions, volunteers] = await Promise.all([
      this.db.from("families").select("id, name, source, archive_consent, is_demo, created_at").range(0, MAX),
      this.db.from("storytellers").select("id, family_id, name, birth_year, consent_at, created_at").range(0, MAX),
      this.db.from("stories").select("family_id, status, parent_story_id, duration_sec, created_at").range(0, MAX),
      this.db.from("books").select("family_id, status, built_at, created_at").range(0, MAX),
      this.db.from("sessions").select("family_id, volunteer_id, mode, started_at").range(0, MAX),
      this.db.from("kiosk_volunteers").select("*").order("name"),
    ]);
    for (const [what, r] of [
      ["семьи", families],
      ["рассказчики", storytellers],
      ["истории", stories],
      ["книги", books],
      ["сессии", sessions],
      ["волонтёры", volunteers],
    ] as const) {
      if (r.error) fail(what, r.error);
    }
    return {
      families: (families.data ?? []) as CenterRows["families"],
      storytellers: (storytellers.data ?? []) as CenterRows["storytellers"],
      stories: (stories.data ?? []) as CenterRows["stories"],
      books: (books.data ?? []) as BookRow[],
      sessions: (sessions.data ?? []) as SessionRow[],
      volunteers: (volunteers.data ?? []) as KioskVolunteer[],
    };
  }

  async addVolunteer(name: string) {
    const { data: found, error: findError } = await this.db.from("kiosk_volunteers").select("*").ilike("name", name).limit(1);
    if (findError) fail("волонтёр", findError);
    const existing = found?.[0] as KioskVolunteer | undefined;
    if (existing) return existing.active ? existing : this.setVolunteerActive(existing.id, true);
    const { data, error } = await this.db.from("kiosk_volunteers").insert({ name }).select("*").single();
    if (error || !data) fail("новый волонтёр", error);
    return data as KioskVolunteer;
  }

  async setVolunteerActive(id: string, active: boolean) {
    if (!isUuid(id)) throw new CenterError("not_found", "Такого волонтёра нет в списке");
    const { data, error } = await this.db.from("kiosk_volunteers").update({ active }).eq("id", id).select("*").maybeSingle();
    if (error) fail("волонтёр", error);
    if (!data) throw new CenterError("not_found", "Такого волонтёра нет в списке");
    return data as KioskVolunteer;
  }
}

type MemoryGlobals = {
  __bookMemory?: Map<string, { book: Book }>;
  __interviewMemoryRepo?: { sessions: Map<string, Session> };
};

class MemoryCenterSource implements CenterSource {
  readonly kind = "memory" as const;
  constructor(
    private families: MemoryFamilyStore,
    private kiosk: MemoryKioskStore,
  ) {}

  async rows(): Promise<CenterRows> {
    const g = globalThis as MemoryGlobals;
    return structuredClone({
      families: [...this.families.families.values()],
      storytellers: [...this.families.storytellers.values()],
      stories: [...this.families.stories.values()],
      books: [...(g.__bookMemory?.values() ?? [])].map(({ book }) => book),
      sessions: [...(g.__interviewMemoryRepo?.sessions.values() ?? [])],
      volunteers: [...this.kiosk.volunteers.values()],
    });
  }

  async addVolunteer(name: string) {
    const existing = [...this.kiosk.volunteers.values()].find((v) => v.name.toLowerCase() === name.toLowerCase());
    if (existing) return this.setVolunteerActive(existing.id, true);
    return this.kiosk.addVolunteer(name);
  }

  async setVolunteerActive(id: string, active: boolean) {
    const v = this.kiosk.volunteers.get(id);
    if (!v) throw new CenterError("not_found", "Такого волонтёра нет в списке");
    v.active = active;
    return structuredClone(v);
  }
}

export function getCenterSource(): CenterSource {
  const db = getDbOrNull();
  if (db) return new SupabaseCenterSource(db);
  return new MemoryCenterSource(getFamilyStore() as MemoryFamilyStore, getKioskStore() as MemoryKioskStore);
}
