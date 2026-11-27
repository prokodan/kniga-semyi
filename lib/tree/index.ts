import "server-only";
// #235 древо семьи: собрать (без ИИ), разложить, править. Флаг family_tree проверяют вызывающие (страница, PDF).
import { applyPlan, planIsEmpty, planTree, type TreeSource } from "./build";
import { layoutTree, type TreeModel } from "./layout";
import { applyPlanToRepo, getTreeRepo, type TreeRepo } from "./repo";
import { createTreeEditor } from "./edit";

export { TreeConflictError } from "./repo";
export { TreeEditError, type PlaceRole } from "./edit";
export type { TreeModel, TreeNode } from "./layout";

/**
 * Древо семьи. write — дописать в базу то, что автоматика нашла нового (идемпотентно, без ИИ): так древо
 * догоняет каждую новую главу и уже готовые семьи без backfill. Сбой записи — древо всё равно показывается.
 */
export async function loadTree(familyId: string, opts: { write?: boolean; viewer?: string | null; repo?: TreeRepo } = {}): Promise<{ model: TreeModel; source: TreeSource }> {
  const repo = opts.repo ?? getTreeRepo();
  const src = await repo.load(familyId);
  const plan = planTree(src);
  if (opts.write && !planIsEmpty(plan)) {
    try {
      await applyPlanToRepo(repo, familyId, plan);
    } catch (e) {
      console.warn(`[tree] ${familyId}: не записали автосборку — ${e instanceof Error ? e.message : e}`);
    }
  }
  const merged = applyPlan(src, plan);
  return { model: layoutTree(merged, plan.claims, opts.viewer), source: merged };
}

export function treeEditor(repo: TreeRepo = getTreeRepo()) {
  return createTreeEditor({ repo, load: async (familyId) => (await loadTree(familyId, { write: true, repo })).source });
}

