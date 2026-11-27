// #235 древо семьи: автосборка без ИИ. Из словаря семьи (family_entities, #102), facts глав (relation — шаг edit)
// и слов родства пакетов (lib/tree/kinship.ts) — люди и рёбра. Чистая функция: на входе всё, что лежит в базе,
// на выходе — что дописать. Идемпотентна: повторный запуск на своём же результате ничего не добавляет.
//
// Правила (дизайн — PR #254):
// - рёбра строятся от рассказчика главы по слову родства (мать → parent, жена → spouse, дед по маме → родитель мамы…);
// - человека, которого семья поставила сама (есть ребро source=family), автоматика не переставляет (правка главнее);
// - «это один человек» (same_as) — на древе запись показывается главной;
// - поколение не храним — его считает layout.ts по рёбрам.
import { factPeople, sameEntity } from "@/lib/pipeline/entities";
import type { FamilyEntity, FamilyRelation, FamilyRelationKind, StoryFact, Storyteller, TreeGender } from "@/lib/types";
import { isKinOnlyName, parseKin, plainName, type Kin } from "./kinship";

export type TreePerson = Pick<
  FamilyEntity,
  "id" | "family_id" | "kind" | "name_ru" | "name_ko" | "description" | "story_ids" | "source" | "birth_year" | "death_year" | "gender" | "same_as"
> &
  Partial<Pick<FamilyEntity, "photo_url">>;
export type TreeEdge = Pick<FamilyRelation, "from_entity_id" | "to_entity_id" | "kind" | "source">;
export type TreeStoryteller = Pick<Storyteller, "id" | "name" | "name_ko" | "birth_year" | "death_year" | "photo_url" | "created_at"> &
  Partial<Pick<Storyteller, "birth_place">> & {
  entity_id?: string | null;
};
export interface TreeChapter {
  id: string;
  storyteller_id: string;
  facts: Pick<StoryFact, "type" | "value" | "relation">[] | null;
}

export interface TreeSource {
  familyId: string;
  storytellers: TreeStoryteller[];
  /** Весь словарь семьи (люди, места, слова) */
  entities: TreePerson[];
  chapters: TreeChapter[];
  relations: TreeEdge[];
}

/** Кто кем приходится рассказчику (narrator — id человека древа, который рассказчик). */
export interface Claim {
  person: string;
  narrator: string;
  kin: Kin;
}

export interface TreePlan {
  /** Новые люди словаря (kind=person, source=auto) — с заранее выданным id, чтобы на них ссылались рёбра */
  people: (Omit<TreePerson, "same_as"> & { kind: "person" })[];
  /** Пол из слова родства — только где пусто */
  genders: { id: string; gender: TreeGender }[];
  /** storytellers.entity_id */
  links: { storytellerId: string; entityId: string }[];
  edges: (TreeEdge & { source: "auto" })[];
  /** Все утверждения о родстве (для подписей и рядов у людей без рёбер) */
  claims: Claim[];
}

/** Главная запись для «это один человек»: идём по same_as (с защитой от петли). */
export function canonical(people: Map<string, Pick<TreePerson, "same_as">>, id: string): string {
  let cur = id;
  const seen = new Set<string>();
  while (!seen.has(cur)) {
    seen.add(cur);
    const next = people.get(cur)?.same_as;
    if (!next || !people.has(next)) return cur;
    cur = next;
  }
  return cur;
}

/** Он / она по имени рассказчика: отчество или «бабушка / дедушка»; корейские имена не различаем. */
export function guessGender(name: string): TreeGender | null {
  const words = name.toLowerCase().replace(/ё/g, "е").split(/\s+/);
  if (words.some((w) => /(овна|евна|ична|инична)$/.test(w)) || words.includes("бабушка") || words.includes("мама")) return "f";
  if (words.some((w) => /(ович|евич|ич)$/.test(w)) || words.includes("дедушка") || words.includes("папа")) return "m";
  return null;
}

const ROLE_ORDER: Kin["role"][] = ["spouse", "parent", "sibling", "child", "grandparent", "auntuncle", "parentInLaw", "grandchild", "nephew", "childInLaw"];

export function planTree(src: TreeSource, newId: () => string = () => crypto.randomUUID()): TreePlan {
  const plan: TreePlan = { people: [], genders: [], links: [], edges: [], claims: [] };
  const all: TreePerson[] = [...src.entities];
  const byId = new Map(all.map((e) => [e.id, e]));
  const persons = () => all.filter((e) => e.kind === "person");
  const canon = (id: string) => canonical(byId, id);
  const findPerson = (name: string) => persons().find((e) => sameEntity(e.name_ru, name)) ?? null;
  const nameTaken = (name: string) => all.some((e) => e.name_ru.trim().toLowerCase() === name.trim().toLowerCase());

  const addPerson = (p: { name_ru: string; name_ko?: string | null; description: string | null; story_ids: string[]; gender: TreeGender | null; birth_year?: number | null; death_year?: number | null }): TreePerson | null => {
    if (!p.name_ru.trim() || nameTaken(p.name_ru)) return null;
    const row = {
      id: newId(),
      family_id: src.familyId,
      kind: "person" as const,
      name_ru: p.name_ru.trim(),
      name_ko: p.name_ko ?? null,
      description: p.description,
      story_ids: p.story_ids,
      source: "auto" as const,
      birth_year: p.birth_year ?? null,
      death_year: p.death_year ?? null,
      gender: p.gender,
    };
    plan.people.push(row);
    const full: TreePerson = { ...row, same_as: null };
    all.push(full);
    byId.set(full.id, full);
    return full;
  };

  // 1. рассказчик — человек древа
  const narratorOf = new Map<string, string>(); // storyteller.id → entity id
  for (const st of [...src.storytellers].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    let id = st.entity_id && byId.has(st.entity_id) ? st.entity_id : null;
    if (!id) {
      const hit = findPerson(st.name);
      const made = hit ?? addPerson({ name_ru: st.name, name_ko: st.name_ko, description: "рассказчик", story_ids: [], gender: guessGender(st.name), birth_year: st.birth_year, death_year: st.death_year });
      if (!made) continue;
      id = made.id;
      plan.links.push({ storytellerId: st.id, entityId: id });
    }
    narratorOf.set(st.id, canon(id));
  }
  const onlyNarrator = narratorOf.size === 1 ? [...narratorOf.values()][0] : null;
  const chapterNarrator = new Map(src.chapters.map((c) => [c.id, narratorOf.get(c.storyteller_id) ?? null]));
  const narratorOfStories = (ids: string[]): string | null => ids.map((id) => chapterNarrator.get(id)).find((x): x is string => !!x) ?? onlyNarrator ?? null;

  const claims: Claim[] = [];
  const claim = (person: string, narrator: string | null, kin: Kin | null) => {
    if (!narrator || !kin) return;
    const p = canon(person);
    if (p === narrator) return;
    if (claims.some((c) => c.person === p && c.narrator === narrator)) return;
    claims.push({ person: p, narrator, kin });
  };
  /** У рассказчика уже есть человек с этой ролью (другой, не except): второй «отец» без имени не нужен */
  const hasRole = (narrator: string, kin: Kin, except: string | null = null) =>
    claims.find(
      (c) => c.narrator === narrator && c.person !== except && c.kin.role === kin.role && c.kin.gender === kin.gender && (c.kin.side ?? null) === (kin.side ?? null),
    );
  /** Человек без имени («отец», «омани»), чья роль у рассказчика уже занята, — дубль, на древо не ставим */
  const duplicateKin = (name: string, kin: Kin | null, narrator: string | null, person: string | null) =>
    !!kin && !!narrator && isKinOnlyName(name) && !!hasRole(narrator, kin, person ? canon(person) : null);

  // 2. люди из facts глав (как словарь, #102): «отец» без имени — тоже человек
  for (const ch of src.chapters) {
    const narrator = chapterNarrator.get(ch.id) ?? null;
    for (const f of ch.facts ?? []) {
      if (f.type !== "person") continue;
      const kin = parseKin(f.relation) ?? parseKin(f.value);
      for (const name of factPeople(f)) {
        let p = findPerson(name);
        if (duplicateKin(name, kin, narrator, p?.id ?? null)) continue;
        p ??= addPerson({ name_ru: name, description: f.relation?.trim() || null, story_ids: [ch.id], gender: kin?.gender ?? null });
        if (p) claim(p.id, narrator, kin);
      }
    }
  }

  // 3. люди словаря с родством в описании («жена, бабушка внуков»)
  for (const e of persons()) {
    const narrator = narratorOfStories(e.story_ids ?? []);
    const kin = parseKin(e.description) ?? (isKinOnlyName(e.name_ru) ? parseKin(e.name_ru) : null);
    if (duplicateKin(e.name_ru, kin, narrator, e.id)) continue;
    claim(e.id, narrator, kin);
  }

  // 4. слова родства из словаря (корё мар, kz): «омани» в главах → у рассказчика есть мама
  for (const w of all.filter((e) => e.kind === "word")) {
    const kin = parseKin(w.name_ru);
    if (!kin || !["parent", "grandparent"].includes(kin.role) || !isKinOnlyName(w.name_ru)) continue;
    const narrator = narratorOfStories(w.story_ids ?? []);
    if (!narrator || hasRole(narrator, kin)) continue;
    const name = plainName(kin.role, kin.gender);
    const p = findPerson(name) ?? addPerson({ name_ru: name, description: `${name} (${w.name_ru})`, story_ids: [...(w.story_ids ?? [])], gender: kin.gender });
    if (p) claim(p.id, narrator, kin);
  }

  // 5. пол из слова родства, где пусто
  for (const c of claims) {
    const p = byId.get(c.person);
    if (p && !p.gender && c.kin.gender) {
      p.gender = c.kin.gender;
      if (!plan.people.some((n) => n.id === p.id)) plan.genders.push({ id: p.id, gender: c.kin.gender });
      else plan.people.find((n) => n.id === p.id)!.gender = c.kin.gender;
    }
  }

  // 6. рёбра
  const edges: TreeEdge[] = src.relations.map((r) => ({ ...r, from_entity_id: canon(r.from_entity_id), to_entity_id: canon(r.to_entity_id) }));
  const familyTouched = new Set(src.relations.filter((r) => r.source === "family").flatMap((r) => [canon(r.from_entity_id), canon(r.to_entity_id)]));
  const has = (kind: FamilyRelationKind, a: string, b: string) =>
    edges.some((e) => e.kind === kind && ((e.from_entity_id === a && e.to_entity_id === b) || (kind !== "parent" && e.from_entity_id === b && e.to_entity_id === a)));
  /** subject — кого ставит автоматика (человек из утверждения): если его место поправила семья — не трогаем */
  const addEdge = (kind: FamilyRelationKind, a: string | undefined, b: string | undefined, subject: string) => {
    if (!a || !b) return;
    const x = canon(a);
    const y = canon(b);
    if (x === y || familyTouched.has(canon(subject)) || has(kind, x, y)) return;
    if (kind === "parent" && has("parent", y, x)) return; // не делаем петлю «родитель своего родителя»
    const e = { from_entity_id: x, to_entity_id: y, kind, source: "auto" as const };
    edges.push(e);
    plan.edges.push(e);
  };
  const gender = (id: string) => byId.get(id)?.gender ?? null;
  const parentsOf = (id: string) => edges.filter((e) => e.kind === "parent" && e.to_entity_id === id).map((e) => e.from_entity_id);
  const childrenOf = (id: string) => edges.filter((e) => e.kind === "parent" && e.from_entity_id === id).map((e) => e.to_entity_id);
  const pairOf = (kind: FamilyRelationKind, id: string) =>
    edges.filter((e) => e.kind === kind && (e.from_entity_id === id || e.to_entity_id === id)).map((e) => (e.from_entity_id === id ? e.to_entity_id : e.from_entity_id));
  const one = (list: string[]) => (new Set(list).size === 1 ? list[0] : undefined);
  const sideParent = (n: string, side: Kin["side"]) => (side ? one(parentsOf(n).filter((p) => gender(p) === (side === "mother" ? "f" : "m"))) : undefined);

  for (let pass = 0; pass < 2; pass++) {
    for (const role of ROLE_ORDER) {
      for (const c of claims.filter((x) => x.kin.role === role)) {
        const n = c.narrator;
        const x = c.person;
        switch (role) {
          case "spouse":
            addEdge("spouse", n, x, x);
            break;
          case "parent":
            addEdge("parent", x, n, x);
            break;
          case "sibling":
            addEdge("sibling", n, x, x);
            for (const par of parentsOf(n)) addEdge("parent", par, x, x); // брат — ребёнок тех же родителей
            break;
          case "child":
            addEdge("parent", n, x, x);
            addEdge("parent", one(pairOf("spouse", n)), x, x);
            break;
          case "grandparent":
            addEdge("parent", x, sideParent(n, c.kin.side), x);
            break;
          case "auntuncle":
            addEdge("sibling", x, sideParent(n, c.kin.side), x);
            break;
          case "parentInLaw":
            addEdge("parent", x, one(pairOf("spouse", n)), x);
            break;
          case "grandchild":
            addEdge("parent", one(childrenOf(n)), x, x);
            break;
          case "nephew":
            addEdge("parent", one(pairOf("sibling", n)), x, x);
            break;
          case "childInLaw":
            addEdge("spouse", one(childrenOf(n)), x, x);
            break;
        }
      }
    }
  }
  // двое родителей разного пола — супруги
  for (const id of new Set(edges.filter((e) => e.kind === "parent").map((e) => e.to_entity_id))) {
    const [a, b, ...rest] = [...new Set(parentsOf(id))];
    if (a && b && !rest.length && gender(a) && gender(b) && gender(a) !== gender(b) && !familyTouched.has(a)) addEdge("spouse", a, b, b);
  }

  plan.claims = claims;
  return plan;
}

/** Применить план к данным в памяти (для чтения древа без записи и для тестов). */
export function applyPlan(src: TreeSource, plan: TreePlan): TreeSource {
  const genders = new Map(plan.genders.map((g) => [g.id, g.gender]));
  const links = new Map(plan.links.map((l) => [l.storytellerId, l.entityId]));
  return {
    ...src,
    storytellers: src.storytellers.map((s) => (links.has(s.id) ? { ...s, entity_id: links.get(s.id)! } : s)),
    entities: [...src.entities.map((e) => (genders.has(e.id) ? { ...e, gender: genders.get(e.id)! } : e)), ...plan.people.map((p) => ({ ...p, same_as: null }))],
    relations: [...src.relations, ...plan.edges],
  };
}

export function planIsEmpty(plan: TreePlan): boolean {
  return !plan.people.length && !plan.genders.length && !plan.links.length && !plan.edges.length;
}
