// #235: контракт хранилища древа — без server-only, чтобы правку и автосборку проверяли тесты.
import type { FamilyEntity } from "@/lib/types";
import type { TreeEdge, TreePerson, TreePlan, TreeSource } from "./build";

export type PersonPatch = Partial<Pick<FamilyEntity, "name_ru" | "name_ko" | "description" | "birth_year" | "death_year" | "gender" | "same_as" | "source" | "photo_url">>;
export type NewPerson = Omit<TreePerson, "same_as"> & { same_as?: string | null };

export interface TreeRepo {
  load(familyId: string): Promise<TreeSource>;
  insertPeople(rows: NewPerson[]): Promise<string[]>;
  updatePerson(familyId: string, id: string, patch: PersonPatch): Promise<void>;
  linkStoryteller(storytellerId: string, entityId: string): Promise<void>;
  insertEdges(familyId: string, rows: TreeEdge[]): Promise<void>;
  /** Удалить все рёбра, где участвует кто-то из ids */
  deleteEdgesOf(familyId: string, ids: string[]): Promise<void>;
}

export class TreeConflictError extends Error {
  constructor(message = "Такое имя уже есть — найдите человека на древе и нажмите «Это тот же человек»") {
    super(message);
    this.name = "TreeConflictError";
  }
}

/** Записать план автосборки. Ошибка одной записи не роняет страницу — древо покажется из памяти. */
export async function applyPlanToRepo(repo: TreeRepo, familyId: string, plan: TreePlan): Promise<void> {
  const ok = new Set(await repo.insertPeople(plan.people));
  const failed = new Set(plan.people.map((p) => p.id).filter((id) => !ok.has(id)));
  for (const gg of plan.genders) await repo.updatePerson(familyId, gg.id, { gender: gg.gender });
  for (const l of plan.links) if (!failed.has(l.entityId)) await repo.linkStoryteller(l.storytellerId, l.entityId);
  await repo.insertEdges(
    familyId,
    plan.edges.filter((e) => !failed.has(e.from_entity_id) && !failed.has(e.to_entity_id)),
  );
}
