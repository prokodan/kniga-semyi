import { describe, expect, it } from "vitest";
import { DEMO_ENTITIES, DEMO_FAMILY, DEMO_STORY_SEEDS, DEMO_STORYTELLER } from "@/fixtures/demo/family";
import { DEMO_BOOK } from "@/lib/book/pdf/demo";
import { renderBook } from "@/lib/book/pdf/render";
import { applyPlan, planIsEmpty, planTree, type TreePerson, type TreeSource } from "./build";
import { treeForBook } from "./book";
import { createTreeEditor } from "./edit";
import { isKinOnlyName, parseKin } from "./kinship";
import { kinPaths, labelFor } from "./labels";
import { layoutTree } from "./layout";
import type { NewPerson, PersonPatch, TreeRepo } from "./store";

const ids = (prefix = "p") => {
  let n = 0;
  return () => `${prefix}${++n}`;
};

/** Демо-семья Ким как в базе после seed-demo: рассказчик, 7 глав с facts, 10 записей словаря (#125). */
function kim(): TreeSource {
  const byKey = new Map(DEMO_STORY_SEEDS.map((s) => [s.key, s.id]));
  return {
    familyId: DEMO_FAMILY.id,
    storytellers: [{ ...DEMO_STORYTELLER, created_at: "2026-11-20T10:00:00Z", entity_id: null }],
    chapters: DEMO_STORY_SEEDS.map((s) => ({ id: s.id, storyteller_id: DEMO_STORYTELLER.id, facts: s.facts })),
    entities: DEMO_ENTITIES.map((e, i) => ({
      id: `e${i}`,
      family_id: DEMO_FAMILY.id,
      kind: e.kind,
      name_ru: e.name_ru,
      name_ko: e.name_ko,
      description: e.description,
      story_ids: e.stories.map((k) => byKey.get(k)!).filter(Boolean),
      source: "auto",
      same_as: null,
    })),
    relations: [],
  };
}

describe("слова родства", () => {
  it("русские, корё мар и казахские", () => {
    expect(parseKin("мать")).toMatchObject({ role: "parent", gender: "f" });
    expect(parseKin("аппади")).toMatchObject({ role: "parent", gender: "m" });
    expect(parseKin("дед по маме")).toMatchObject({ role: "grandparent", gender: "m", side: "mother" });
    expect(parseKin("нағашы ата")).toMatchObject({ role: "grandparent", side: "mother" });
    expect(parseKin("жена, бабушка внуков")).toMatchObject({ role: "spouse", gender: "f" });
    expect(parseKin("двоюродный брат")).toMatchObject({ role: "cousin" });
    expect(parseKin("учительница")).toBeNull();
    expect(parseKin("братство")).toBeNull();
  });

  it("имя — само слово родства", () => {
    expect(isKinOnlyName("отец")).toBe(true);
    expect(isKinOnlyName("дед по маме")).toBe(true);
    expect(isKinOnlyName("Анна Петровна")).toBe(false);
    expect(isKinOnlyName("Валентина")).toBe(false);
  });
});

describe("автосборка древа (демо-семья Ким)", () => {
  it("рассказчик, отец, мама (омани), брат, жена; учительница — не на древе", () => {
    const src = kim();
    const plan = planTree(src, ids());
    const all = applyPlan(src, plan);
    const model = layoutTree(all, plan.claims);
    const by = (label: string) => model.nodes.find((n) => n.label?.ru === label);
    expect(model.nodes.find((n) => n.isViewer)?.name).toBe("Ким Чер Су");
    expect(by("жена")?.name).toBe("Валентина");
    expect(by("папа")?.name).toBe("Папа");
    expect(by("мама")).toBeTruthy();
    expect(by("брат")).toBeTruthy();
    expect(model.others.map((o) => o.name)).toContain("Анна Петровна");
    // родители — рядом, на ряд выше, супругами
    expect(by("папа")!.y).toBeLessThan(model.nodes.find((n) => n.isViewer)!.y);
    expect(model.couples.length).toBeGreaterThanOrEqual(2);
    expect(plan.links).toHaveLength(1);
  });

  it("повторный запуск ничего не добавляет", () => {
    const src = kim();
    const plan = planTree(src, ids());
    expect(planIsEmpty(planTree(applyPlan(src, plan), ids()))).toBe(true);
  });

  it("правка семьи главнее: человека с ребром family автоматика не трогает", () => {
    const src = kim();
    const plan = planTree(src, ids());
    const all = applyPlan(src, plan);
    const vale = all.entities.find((e) => e.name_ru === "Валентина")!;
    const other = all.entities.find((e) => e.name_ru === "брат")!;
    const edited: TreeSource = {
      ...all,
      relations: [...all.relations.filter((r) => r.from_entity_id !== vale.id && r.to_entity_id !== vale.id), { from_entity_id: vale.id, to_entity_id: other.id, kind: "spouse", source: "family" }],
    };
    expect(planTree(edited, ids()).edges.some((e) => e.from_entity_id === vale.id || e.to_entity_id === vale.id)).toBe(false);
  });
});

describe("подписи от того, чью книгу смотрят", () => {
  it("мама одного — бабушка внука; свекровь у жены, тёща у мужа", () => {
    const edges = [
      { from_entity_id: "mom", to_entity_id: "me", kind: "parent" as const, source: "auto" as const },
      { from_entity_id: "me", to_entity_id: "kid", kind: "parent" as const, source: "auto" as const },
      { from_entity_id: "me", to_entity_id: "wife", kind: "spouse" as const, source: "auto" as const },
      { from_entity_id: "wmom", to_entity_id: "wife", kind: "parent" as const, source: "auto" as const },
    ];
    expect(labelFor(kinPaths("me", edges).get("mom"), "f", "m")?.ru).toBe("мама");
    expect(labelFor(kinPaths("kid", edges).get("mom"), "f", null)?.ru).toBe("бабушка");
    expect(labelFor(kinPaths("me", edges).get("wmom"), "f", "m")?.ru).toBe("тёща");
    expect(labelFor(kinPaths("wife", edges).get("mom"), "f", "f")?.ru).toBe("свекровь");
    expect(labelFor(kinPaths("me", edges).get("mom"), "f", "m")?.gen).toBe("мамы");
  });
});

class MemRepo implements TreeRepo {
  constructor(public src: TreeSource) {}
  async load() {
    return structuredClone(this.src);
  }
  async insertPeople(rows: NewPerson[]) {
    for (const r of rows) {
      if (this.src.entities.some((e) => e.name_ru.toLowerCase() === r.name_ru.toLowerCase())) throw new Error("дубль");
      this.src.entities.push({ ...r, same_as: r.same_as ?? null } as TreePerson);
    }
    return rows.map((r) => r.id);
  }
  async updatePerson(_f: string, id: string, patch: PersonPatch) {
    this.src.entities = this.src.entities.map((e) => (e.id === id ? { ...e, ...patch } : e));
  }
  async linkStoryteller(stId: string, entityId: string) {
    this.src.storytellers = this.src.storytellers.map((s) => (s.id === stId ? { ...s, entity_id: entityId } : s));
  }
  async insertEdges(_f: string, rows: TreeSource["relations"]) {
    this.src.relations.push(...rows);
  }
  async deleteEdgesOf(_f: string, list: string[]) {
    this.src.relations = this.src.relations.filter((r) => !list.includes(r.from_entity_id) && !list.includes(r.to_entity_id));
  }
}

describe("правка семьи", () => {
  const setup = () => {
    const src = kim();
    const plan = planTree(src, ids());
    const repo = new MemRepo(applyPlan(src, plan));
    const ed = createTreeEditor({ repo, load: async () => applyPlan(repo.src, planTree(repo.src, ids())), newId: ids("n") });
    const model = () => {
      const p = planTree(repo.src, ids());
      return layoutTree(applyPlan(repo.src, p), p.claims);
    };
    return { repo, ed, model };
  };

  it("вписать имя отцу: на древе имя, «отец» остаётся в словаре", async () => {
    const { repo, ed, model } = setup();
    const dad = model().nodes.find((n) => n.label?.ru === "папа")!;
    await ed.update(DEMO_FAMILY.id, dad.id, { name: "Ким Ён Хо", birthYear: "1912", deathYear: "1980" });
    const now = model().nodes.find((n) => n.label?.ru === "папа")!;
    expect(now.name).toBe("Ким Ён Хо");
    expect(now.years).toBe("1912–1980");
    expect(repo.src.entities.find((e) => e.name_ru === "отец")?.same_as).toBe(now.id);
  });

  it("добавить человека и поставить на место; «это один человек»", async () => {
    const { ed, model } = setup();
    const me = model().nodes.find((n) => n.isViewer)!;
    const { id } = await ed.add(DEMO_FAMILY.id, { name: "Ким Олег", role: "son", other: me.id, birthYear: "1965" });
    expect(model().nodes.find((n) => n.id === id)?.label?.ru).toBe("сын");
    const anna = model().others.find((o) => o.name === "Анна Петровна")!;
    await ed.place(DEMO_FAMILY.id, anna.id, "sister", me.id);
    expect(model().nodes.find((n) => n.id === anna.id)?.label?.ru).toBe("сестра");
    const brother = model().nodes.find((n) => n.label?.ru === "брат")!;
    await ed.merge(DEMO_FAMILY.id, id, brother.id);
    expect(model().nodes.some((n) => n.id === id)).toBe(false);
  });

  it("неверный год — понятная ошибка", async () => {
    const { ed, model } = setup();
    const me = model().nodes.find((n) => n.isViewer)!;
    await expect(ed.update(DEMO_FAMILY.id, me.id, { birthYear: "19x0" })).rejects.toThrow(/год/);
  });
});

describe("страница древа в PDF", () => {
  it("демо Ким: страница есть, книга собирается", async () => {
    const src = kim();
    const plan = planTree(src, ids());
    const tree = treeForBook(layoutTree(applyPlan(src, plan), plan.claims), true);
    expect(tree?.rows.flat().some((p) => p.viewer)).toBe(true);
    const voiceUrl = (id: string) => `https://kniga.example/listen/${id}`;
    const without = await renderBook({ ...DEMO_BOOK, voiceUrl });
    const withTree = await renderBook({ ...DEMO_BOOK, voiceUrl, tree });
    expect(withTree.pageCount).toBe(without.pageCount + 1);
  }, 60_000);
});
