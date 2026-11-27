// #235: правка древа семьёй. Всё, что меняет семья, — source=family: автоматика такого человека больше не трогает.
// Тексты глав здесь не меняются (для написания в главах есть «Словарь имён», #104).
import type { FamilyRelationKind, TreeGender } from "@/lib/types";
import { canonical, type TreeEdge, type TreePerson, type TreeSource } from "./build";
import type { TreeRepo } from "./store";

export class TreeEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TreeEditError";
  }
}

/** «X — <роль> для Y»: кем приходится. */
export type PlaceRole = "mother" | "father" | "wife" | "husband" | "daughter" | "son" | "sister" | "brother";

export const PLACE_ROLES: { role: PlaceRole; ru: string }[] = [
  { role: "mother", ru: "мама" },
  { role: "father", ru: "папа" },
  { role: "wife", ru: "жена" },
  { role: "husband", ru: "муж" },
  { role: "daughter", ru: "дочь" },
  { role: "son", ru: "сын" },
  { role: "sister", ru: "сестра" },
  { role: "brother", ru: "брат" },
];

const ROLE: Record<PlaceRole, { kind: FamilyRelationKind; gender: TreeGender; up: boolean }> = {
  mother: { kind: "parent", gender: "f", up: true },
  father: { kind: "parent", gender: "m", up: true },
  wife: { kind: "spouse", gender: "f", up: false },
  husband: { kind: "spouse", gender: "m", up: false },
  daughter: { kind: "parent", gender: "f", up: false },
  son: { kind: "parent", gender: "m", up: false },
  sister: { kind: "sibling", gender: "f", up: false },
  brother: { kind: "sibling", gender: "m", up: false },
};

export function isPlaceRole(v: unknown): v is PlaceRole {
  return typeof v === "string" && v in ROLE;
}

/** Ребро «X — роль для Y» */
export function edgeFor(x: string, role: PlaceRole, y: string): TreeEdge {
  const r = ROLE[role];
  if (r.kind === "parent") return r.up ? { from_entity_id: x, to_entity_id: y, kind: "parent", source: "family" } : { from_entity_id: y, to_entity_id: x, kind: "parent", source: "family" };
  return { from_entity_id: y, to_entity_id: x, kind: r.kind, source: "family" };
}

export interface PersonInput {
  name?: string;
  nameKo?: string | null;
  birthYear?: number | string | null;
  deathYear?: number | string | null;
  gender?: TreeGender | null;
}

const thisYear = () => new Date().getFullYear();

function year(v: number | string | null | undefined, what: string): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isInteger(n) || n < 1800 || n > thisYear()) throw new TreeEditError(`${what}: год от 1800 до ${thisYear()}`);
  return n;
}

function name(v: string | undefined, required: boolean): string | null {
  const s = (v ?? "").replace(/\s+/g, " ").trim();
  if (!s) {
    if (required) throw new TreeEditError("Напишите имя");
    return null;
  }
  if (s.length > 80) throw new TreeEditError("Имя слишком длинное: до 80 знаков");
  return s;
}

function gender(v: unknown): TreeGender | null {
  return v === "f" || v === "m" ? v : null;
}

export function createTreeEditor(deps: { repo: TreeRepo; load: (familyId: string) => Promise<TreeSource>; newId?: () => string }) {
  const { repo, load } = deps;
  const newId = deps.newId ?? (() => crypto.randomUUID());

  async function ctx(familyId: string) {
    const src = await load(familyId);
    const byId = new Map(src.entities.map((e) => [e.id, e]));
    const canon = (id: string) => canonical(byId, id);
    const person = (id: string): TreePerson => {
      const e = byId.get(id);
      if (!e || e.kind !== "person") throw new TreeEditError("Этого человека на древе нет — обновите страницу");
      return byId.get(canon(id))!;
    };
    const aliases = (id: string) => src.entities.filter((e) => canon(e.id) === id).map((e) => e.id);
    /** Рёбра для «X — роль для Y»; сын / дочь человека с одним супругом — ребёнок пары */
    const edgesFor = (x: string, role: PlaceRole, y: string): TreeEdge[] => {
      const out = [edgeFor(x, role, y)];
      if (role === "son" || role === "daughter") {
        const sp = [
          ...new Set(
            src.relations
              .filter((r) => r.kind === "spouse" && (canon(r.from_entity_id) === y || canon(r.to_entity_id) === y))
              .map((r) => (canon(r.from_entity_id) === y ? canon(r.to_entity_id) : canon(r.from_entity_id))),
          ),
        ].filter((id) => id !== x);
        if (sp.length === 1 && sp[0]) out.push(edgeFor(x, role, sp[0]));
      }
      return out;
    };
    return { src, byId, canon, person, aliases, edgesFor };
  }

  return {
    /** Имя, по-корейски, годы, он / она. Новое имя — новая запись (старая остаётся в словаре как «тот же человек»). */
    async update(familyId: string, id: string, input: PersonInput) {
      const { src, person } = await ctx(familyId);
      const p = person(id);
      const nm = name(input.name, false);
      const patch = {
        name_ko: input.nameKo === undefined ? (p.name_ko ?? null) : (input.nameKo?.trim() || null),
        birth_year: input.birthYear === undefined ? (p.birth_year ?? null) : year(input.birthYear, "Год рождения"),
        death_year: input.deathYear === undefined ? (p.death_year ?? null) : year(input.deathYear, "Год смерти"),
        gender: input.gender === undefined ? (p.gender ?? null) : gender(input.gender),
      };
      if (patch.birth_year && patch.death_year && patch.death_year < patch.birth_year) throw new TreeEditError("Год смерти раньше года рождения");
      if (nm && nm.toLowerCase() !== p.name_ru.toLowerCase()) {
        const same = src.entities.find((e) => e.name_ru.trim().toLowerCase() === nm.toLowerCase());
        if (same && same.kind !== "person") throw new TreeEditError(`«${nm}» уже есть в словаре как место или слово — выберите другое написание`);
        if (same) {
          await repo.updatePerson(familyId, same.id, { ...patch, source: "family", same_as: null }); // вдруг это прежнее имя этого же человека
          await repo.updatePerson(familyId, p.id, { same_as: same.id });
          return { id: same.id };
        }
        const nid = newId();
        await repo.insertPeople([
          { id: nid, family_id: familyId, kind: "person", name_ru: nm, description: p.description, story_ids: p.story_ids ?? [], source: "family", ...patch },
        ]);
        await repo.updatePerson(familyId, p.id, { same_as: nid });
        return { id: nid };
      }
      await repo.updatePerson(familyId, p.id, { ...patch, source: "family" });
      return { id: p.id };
    },

    /** «Это один человек»: id показывается как into (тексты глав не меняются) */
    async merge(familyId: string, id: string, into: string) {
      const { person } = await ctx(familyId);
      const a = person(id);
      const b = person(into);
      if (a.id === b.id) throw new TreeEditError("Это уже один человек");
      await repo.updatePerson(familyId, b.id, {
        name_ko: b.name_ko ?? a.name_ko ?? null,
        birth_year: b.birth_year ?? a.birth_year ?? null,
        death_year: b.death_year ?? a.death_year ?? null,
        gender: b.gender ?? a.gender ?? null,
        ...(!b.photo_url && a.photo_url ? { photo_url: a.photo_url } : {}),
      });
      await repo.updatePerson(familyId, a.id, { same_as: b.id });
      return { id: b.id };
    },

    /** #269: фото человека (путь в бакете photos; null — убрать). Возвращает прежний путь — его файл можно удалить. */
    async setPhoto(familyId: string, id: string, path: string | null) {
      const { person } = await ctx(familyId);
      const p = person(id);
      await repo.updatePerson(familyId, p.id, { photo_url: path });
      return { id: p.id, previous: p.photo_url ?? null };
    },

    /** «Поставить на место»: X — роль для Y. Прежние связи X заменяются этой (правка семьи). */
    async place(familyId: string, id: string, role: PlaceRole, other: string) {
      if (!isPlaceRole(role)) throw new TreeEditError("Выберите, кем приходится");
      const { person, aliases, edgesFor } = await ctx(familyId);
      const x = person(id);
      const y = person(other);
      if (x.id === y.id) throw new TreeEditError("Выберите другого человека");
      await repo.deleteEdgesOf(familyId, aliases(x.id));
      await repo.insertEdges(familyId, edgesFor(x.id, role, y.id));
      await repo.updatePerson(familyId, x.id, { gender: ROLE[role].gender, source: "family" });
      return { id: x.id };
    },

    /** Добавить человека: имя и кем приходится кому-то на древе */
    async add(familyId: string, input: PersonInput & { role: PlaceRole; other: string }) {
      if (!isPlaceRole(input.role)) throw new TreeEditError("Выберите, кем приходится");
      const { src, person, edgesFor } = await ctx(familyId);
      const nm = name(input.name, true)!;
      const y = person(input.other);
      const same = src.entities.find((e) => e.name_ru.trim().toLowerCase() === nm.toLowerCase());
      if (same) throw new TreeEditError(`«${nm}» уже есть — найдите на древе или в «Ещё в рассказах» и нажмите «Поставить на место»`);
      const b = year(input.birthYear, "Год рождения");
      const d = year(input.deathYear, "Год смерти");
      if (b && d && d < b) throw new TreeEditError("Год смерти раньше года рождения");
      const nid = newId();
      await repo.insertPeople([
        {
          id: nid,
          family_id: familyId,
          kind: "person",
          name_ru: nm,
          name_ko: input.nameKo?.trim() || null,
          description: null,
          story_ids: [],
          source: "family",
          birth_year: b,
          death_year: d,
          gender: ROLE[input.role].gender,
        },
      ]);
      await repo.insertEdges(familyId, edgesFor(nid, input.role, y.id));
      return { id: nid };
    },
  };
}
