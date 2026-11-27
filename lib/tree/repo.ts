import "server-only";
// #235: хранилище древа. Supabase (service-ключ) — прод и staging; без него — память процесса (локально, mock).
// Таблицы: family_relations, family_entities (+ birth_year, death_year, gender, same_as), storytellers.entity_id,
// stories.facts (только чтение).
import { getDbOrNull } from "@/lib/db";
import type { FamilyEntity, FamilyRelation, Story, Storyteller } from "@/lib/types";
import type { TreeChapter, TreeEdge, TreePerson, TreeSource, TreeStoryteller } from "./build";
import { TreeConflictError, type NewPerson, type PersonPatch, type TreeRepo } from "./store";

export { applyPlanToRepo, TreeConflictError, type TreeRepo } from "./store";

type Db = NonNullable<ReturnType<typeof getDbOrNull>>;

export class SupabaseTreeRepo implements TreeRepo {
  constructor(private readonly db: Db) {}

  async load(familyId: string): Promise<TreeSource> {
    const [ent, st, ch, rel] = await Promise.all([
      this.db.from("family_entities").select("*").eq("family_id", familyId),
      this.db.from("storytellers").select("*").eq("family_id", familyId).order("created_at", { ascending: true }),
      this.db.from("stories").select("id, storyteller_id, facts, status").eq("family_id", familyId).is("parent_story_id", null).neq("status", "skipped").order("created_at", { ascending: true }),
      this.db.from("family_relations").select("from_entity_id, to_entity_id, kind, source").eq("family_id", familyId),
    ]);
    for (const [name, r] of [["словарь", ent], ["рассказчики", st], ["главы", ch], ["древо", rel]] as const) {
      if (r.error) throw new Error(`древо, ${name}: ${r.error.message}`);
    }
    return {
      familyId,
      entities: (ent.data ?? []) as TreePerson[],
      storytellers: (st.data ?? []) as TreeStoryteller[],
      chapters: ((ch.data ?? []) as Pick<Story, "id" | "storyteller_id" | "facts">[]).map((c) => ({ id: c.id, storyteller_id: c.storyteller_id, facts: c.facts ?? [] })),
      relations: (rel.data ?? []) as TreeEdge[],
    };
  }

  async insertPeople(rows: NewPerson[]): Promise<string[]> {
    const ok: string[] = [];
    for (const row of rows) {
      const { error } = await this.db.from("family_entities").insert(row);
      if (!error) ok.push(row.id);
      else if (error.code === "23505") {
        if (rows.length === 1) throw new TreeConflictError();
      } else throw new Error(`древо, человек: ${error.message}`);
    }
    return ok;
  }

  async updatePerson(familyId: string, id: string, patch: PersonPatch): Promise<void> {
    const { error } = await this.db.from("family_entities").update(patch).eq("id", id).eq("family_id", familyId);
    if (error?.code === "23505") throw new TreeConflictError();
    if (error) throw new Error(`древо, правка: ${error.message}`);
  }

  async linkStoryteller(storytellerId: string, entityId: string): Promise<void> {
    const { error } = await this.db.from("storytellers").update({ entity_id: entityId }).eq("id", storytellerId).is("entity_id", null);
    if (error) throw new Error(`древо, рассказчик: ${error.message}`);
  }

  async insertEdges(familyId: string, rows: TreeEdge[]): Promise<void> {
    if (!rows.length) return;
    const { error } = await this.db
      .from("family_relations")
      .upsert(
        rows.map((r) => ({ ...r, family_id: familyId })),
        { onConflict: "family_id,from_entity_id,to_entity_id,kind", ignoreDuplicates: true },
      );
    if (error) throw new Error(`древо, связи: ${error.message}`);
  }

  async deleteEdgesOf(familyId: string, ids: string[]): Promise<void> {
    if (!ids.length) return;
    const list = `(${ids.join(",")})`;
    const { error } = await this.db.from("family_relations").delete().eq("family_id", familyId).or(`from_entity_id.in.${list},to_entity_id.in.${list}`);
    if (error) throw new Error(`древо, связи: ${error.message}`);
  }
}

// ---------------- память процесса (локально без Supabase) ----------------

const g = globalThis as {
  __entityMemory?: Map<string, FamilyEntity>;
  __treeMemory?: FamilyRelation[];
  __familyMemoryStore?: { storytellers: Map<string, Storyteller>; stories: Map<string, Story> };
};

export class MemoryTreeRepo implements TreeRepo {
  private get entities() {
    return (g.__entityMemory ??= new Map());
  }
  private get relations() {
    return (g.__treeMemory ??= []);
  }

  async load(familyId: string): Promise<TreeSource> {
    const store = g.__familyMemoryStore;
    const chapters: TreeChapter[] = [...(store?.stories.values() ?? [])]
      .filter((s) => s.family_id === familyId && !s.parent_story_id && s.status !== "skipped")
      .map((s) => ({ id: s.id, storyteller_id: s.storyteller_id, facts: s.facts ?? [] }));
    return structuredClone({
      familyId,
      entities: [...this.entities.values()].filter((e) => e.family_id === familyId),
      storytellers: [...(store?.storytellers.values() ?? [])].filter((s) => s.family_id === familyId),
      chapters,
      relations: this.relations.filter((r) => r.family_id === familyId),
    });
  }

  async insertPeople(rows: NewPerson[]): Promise<string[]> {
    const ok: string[] = [];
    for (const row of rows) {
      const clash = [...this.entities.values()].some((e) => e.family_id === row.family_id && e.name_ru.toLowerCase() === row.name_ru.toLowerCase());
      if (clash) {
        if (rows.length === 1) throw new TreeConflictError();
        continue;
      }
      this.entities.set(row.id, { ...row, same_as: row.same_as ?? null, updated_at: new Date().toISOString() } as FamilyEntity);
      ok.push(row.id);
    }
    return ok;
  }

  async updatePerson(familyId: string, id: string, patch: PersonPatch): Promise<void> {
    const cur = this.entities.get(id);
    if (!cur || cur.family_id !== familyId) return;
    if (patch.name_ru && [...this.entities.values()].some((e) => e.id !== id && e.family_id === familyId && e.name_ru.toLowerCase() === patch.name_ru!.toLowerCase())) {
      throw new TreeConflictError();
    }
    this.entities.set(id, { ...cur, ...patch, updated_at: new Date().toISOString() });
  }

  async linkStoryteller(storytellerId: string, entityId: string): Promise<void> {
    const st = g.__familyMemoryStore?.storytellers.get(storytellerId);
    if (st && !st.entity_id) st.entity_id = entityId;
  }

  async insertEdges(familyId: string, rows: TreeEdge[]): Promise<void> {
    for (const r of rows) {
      const dup = this.relations.some((x) => x.family_id === familyId && x.from_entity_id === r.from_entity_id && x.to_entity_id === r.to_entity_id && x.kind === r.kind);
      if (!dup) this.relations.push({ ...r, id: crypto.randomUUID(), family_id: familyId, created_at: new Date().toISOString() });
    }
  }

  async deleteEdgesOf(familyId: string, ids: string[]): Promise<void> {
    g.__treeMemory = this.relations.filter((r) => r.family_id !== familyId || (!ids.includes(r.from_entity_id) && !ids.includes(r.to_entity_id)));
  }
}

export function getTreeRepo(): TreeRepo {
  const db = getDbOrNull();
  return db ? new SupabaseTreeRepo(db) : new MemoryTreeRepo();
}

