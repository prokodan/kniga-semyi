import "server-only";
// Хранилище словаря (#104): таблица family_entities (миграция #118) и главы stories.
// Supabase (service-ключ) — прод; без него — память процесса (локальный запуск, mock).
// #245: текст глав — по правилу story_texts → колонки (withStoryTexts, одна загрузка на запрос); пишем по-прежнему
// в колонки stories (триггер stories_mirror_texts держит story_texts в ногу).
import { loadStoryTexts, withStoryTexts } from "@/lib/book/texts";
import { getDbOrNull } from "@/lib/db";
import { MemoryInterviewRepo } from "@/lib/interview/repo";
import { EntityError, type ChapterPatch, type ChapterText, type EntityRepo, type EntityRow, type NewEntity } from "./service";

const CHAPTER_FIELDS = "id, status, title, quote, text_ru, title_ko, quote_ko, text_ko, created_at";

function conflict(e: { code?: string; message: string }): Error {
  // 23505 — уникальность (family_id, lower(name_ru))
  return e.code === "23505" ? new EntityError("conflict", "Такое имя уже есть в словаре — объедините записи") : new Error(`словарь: ${e.message}`);
}

export class SupabaseEntityRepo implements EntityRepo {
  constructor(private readonly db: NonNullable<ReturnType<typeof getDbOrNull>>) {}

  async list(familyId: string): Promise<EntityRow[]> {
    const { data, error } = await this.db.from("family_entities").select("*").eq("family_id", familyId);
    if (error) throw conflict(error);
    return (data ?? []) as EntityRow[];
  }

  async insert(row: NewEntity): Promise<EntityRow> {
    const { data, error } = await this.db.from("family_entities").insert(row).select("*").single();
    if (error || !data) throw conflict(error ?? { message: "нет данных" });
    return data as EntityRow;
  }

  async update(id: string, patch: Partial<NewEntity>): Promise<EntityRow> {
    const { data, error } = await this.db.from("family_entities").update(patch).eq("id", id).select("*").single();
    if (error || !data) throw conflict(error ?? { message: "нет данных" });
    return data as EntityRow;
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.db.from("family_entities").delete().eq("id", id);
    if (error) throw conflict(error);
  }

  async chapters(familyId: string): Promise<ChapterText[]> {
    const { data, error } = await this.db
      .from("stories")
      .select(CHAPTER_FIELDS)
      .eq("family_id", familyId)
      .is("parent_story_id", null)
      .neq("status", "skipped")
      .order("created_at", { ascending: true });
    if (error) throw new Error(`главы: ${error.message}`);
    const chapters = (data ?? []) as ChapterText[];
    const texts = await loadStoryTexts(this.db, chapters.map((c) => c.id));
    return chapters.map((c) => withStoryTexts(c, texts));
  }

  async saveChapter(id: string, patch: ChapterPatch): Promise<void> {
    const { error } = await this.db
      .from("stories")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(`глава: ${error.message}`);
  }
}

const g = globalThis as { __interviewMemoryRepo?: MemoryInterviewRepo; __entityMemory?: Map<string, EntityRow> };

/** Память процесса: те же истории, что у конвейера и правки главы (components/draft/save.ts). */
export class MemoryEntityRepo implements EntityRepo {
  constructor(
    readonly rows: Map<string, EntityRow> = (g.__entityMemory ??= new Map()),
    readonly stories: MemoryInterviewRepo = (g.__interviewMemoryRepo ??= new MemoryInterviewRepo()),
  ) {}

  async list(familyId: string) {
    return structuredClone([...this.rows.values()].filter((r) => r.family_id === familyId));
  }

  private clash(row: Pick<EntityRow, "id" | "family_id" | "name_ru">) {
    for (const r of this.rows.values()) {
      if (r.id !== row.id && r.family_id === row.family_id && r.name_ru.toLowerCase() === row.name_ru.toLowerCase()) {
        throw new EntityError("conflict", "Такое имя уже есть в словаре — объедините записи");
      }
    }
  }

  async insert(row: NewEntity) {
    const e: EntityRow = { ...row, id: crypto.randomUUID(), updated_at: new Date().toISOString() };
    this.clash(e);
    this.rows.set(e.id, e);
    return structuredClone(e);
  }

  async update(id: string, patch: Partial<NewEntity>) {
    const cur = this.rows.get(id);
    if (!cur) throw new EntityError("not_found", "Такой записи в словаре нет");
    const next = { ...cur, ...patch, updated_at: new Date().toISOString() };
    this.clash(next);
    this.rows.set(id, next);
    return structuredClone(next);
  }

  async remove(id: string) {
    this.rows.delete(id);
  }

  async chapters(familyId: string): Promise<ChapterText[]> {
    return [...this.stories.stories.values()]
      .filter((s) => s.family_id === familyId && !s.parent_story_id && s.status !== "skipped")
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map(({ id, status, title, quote, text_ru, title_ko, quote_ko, text_ko }) => ({ id, status, title, quote, text_ru, title_ko, quote_ko, text_ko }));
  }

  async saveChapter(id: string, patch: ChapterPatch) {
    const s = this.stories.stories.get(id);
    if (!s) throw new EntityError("not_found", "Глава не найдена");
    Object.assign(s, patch, { updated_at: new Date().toISOString() });
  }
}

export function getEntityRepo(): EntityRepo {
  const db = getDbOrNull();
  return db ? new SupabaseEntityRepo(db) : new MemoryEntityRepo();
}
