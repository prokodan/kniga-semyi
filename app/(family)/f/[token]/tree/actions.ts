"use server";
// #235: правка древа семьёй — server actions страницы /f/<токен>/tree. Вход — токен семьи (как у всей семьи, без
// регистрации); флаг family_tree выключен для семьи → «недоступно».
import { getFamilyByToken } from "@/lib/db/access";
import { flag } from "@/lib/flags";
import { TreeConflictError, TreeEditError, treeEditor, type PlaceRole } from "@/lib/tree";

export type TreeOp =
  | { op: "update"; id: string; name?: string; nameKo?: string | null; birthYear?: string | null; deathYear?: string | null; gender?: "f" | "m" | null }
  | { op: "merge"; id: string; into: string }
  | { op: "place"; id: string; role: PlaceRole; other: string }
  | { op: "add"; name: string; nameKo?: string | null; birthYear?: string | null; deathYear?: string | null; role: PlaceRole; other: string };

export interface TreeOpResult {
  ok: boolean;
  message: string;
}

const DONE: Record<TreeOp["op"], string> = {
  update: "Сохранили",
  merge: "Объединили — теперь это один человек",
  place: "Поставили на место",
  add: "Добавили на древо",
};

export async function treeAction(token: string, input: TreeOp): Promise<TreeOpResult> {
  try {
    const view = await getFamilyByToken(String(token));
    if (!view) return { ok: false, message: "Ссылка не открылась — откройте её ещё раз из сообщения" };
    const { family } = view;
    if (!flag("family_tree", { familyId: family.id, labs: family.labs })) return { ok: false, message: "Древо пока недоступно" };
    if (!input || typeof input !== "object") return { ok: false, message: "Не поняли, что сохранить. Обновите страницу." };
    const ed = treeEditor();
    switch (input.op) {
      case "update":
        await ed.update(family.id, input.id, { name: input.name, nameKo: input.nameKo, birthYear: input.birthYear, deathYear: input.deathYear, gender: input.gender });
        break;
      case "merge":
        await ed.merge(family.id, input.id, input.into);
        break;
      case "place":
        await ed.place(family.id, input.id, input.role, input.other);
        break;
      case "add":
        await ed.add(family.id, { name: input.name, nameKo: input.nameKo, birthYear: input.birthYear, deathYear: input.deathYear, role: input.role, other: input.other });
        break;
      default:
        return { ok: false, message: "Не поняли, что сохранить. Обновите страницу." };
    }
    return { ok: true, message: DONE[input.op] };
  } catch (e) {
    if (e instanceof TreeEditError || e instanceof TreeConflictError) return { ok: false, message: e.message };
    console.error("[tree] правка:", e instanceof Error ? e.message : e);
    return { ok: false, message: "Не получилось сохранить. Попробуйте ещё раз." };
  }
}
