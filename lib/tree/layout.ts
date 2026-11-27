// #235: раскладка древа — поколения рядами, рассказчик в центре своего ряда, супруги рядом, линии к детям.
// Чистая функция: и для страницы /f/<токен>/tree (SVG-линии + карточки), и для страницы древа в PDF.
import type { TreeGender } from "@/lib/types";
import { canonical, type Claim, type TreeEdge, type TreePerson, type TreeSource } from "./build";
import { isKinOnlyName } from "./kinship";
import { kinPaths, labelFor, type KinLabel } from "./labels";

export const CARD = { w: 136, h: 132, gapX: 18, gapY: 64, pad: 16 };

export interface TreeNode {
  id: string;
  /** Как подписать: имя, а у человека без имени («отец») — родство от смотрящего с большой буквы */
  name: string;
  nameKo: string | null;
  /** Имя в словаре (для правки), у человека без имени — пусто */
  realName: string | null;
  years: string | null;
  birthYear: number | null;
  deathYear: number | null;
  gender: TreeGender | null;
  label: KinLabel | null;
  /** id рассказчика, если у этого человека есть своя книга */
  storytellerId: string | null;
  isViewer: boolean;
  /** Стоит в ряду по слову родства, но не связан рёбрами — «уточните, чья» */
  loose: boolean;
  kinOnly: boolean;
  /** Есть правка семьи — автоматика его не трогает */
  checked: boolean;
  gen: number;
  x: number;
  y: number;
  chapters: number;
}

export interface TreeLine {
  kind: "spouse" | "child" | "sibling";
  d: string;
}

export interface TreeRow {
  gen: number;
  y: number;
  ids: string[];
}

export interface TreeModel {
  viewer: string | null;
  nodes: TreeNode[];
  lines: TreeLine[];
  rows: TreeRow[];
  width: number;
  height: number;
  /** Люди из рассказов без родства («учительница», «соседка») — не на древе */
  others: TreeNode[];
  /** Супруги, стоящие рядом (левый, правый) — для PDF */
  couples: [string, string][];
}

export function yearsText(b: number | null | undefined, d: number | null | undefined): string | null {
  if (b && d) return `${b}–${d}`;
  if (b) return `${b}`;
  if (d) return `† ${d}`;
  return null;
}

/** Слово родства рассказчика → путь по рёбрам (для подписи человека, которого ещё не связали). */
const ROLE_PATH: Record<Claim["kin"]["role"], string> = {
  parent: "P",
  grandparent: "PP",
  greatgrandparent: "PPP",
  child: "C",
  grandchild: "CC",
  spouse: "S",
  sibling: "B",
  auntuncle: "PB",
  nephew: "BC",
  cousin: "PBC",
  parentInLaw: "SP",
  childInLaw: "CS",
};

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function layoutTree(src: TreeSource, claims: Claim[], viewerStorytellerId?: string | null): TreeModel {
  const byId = new Map(src.entities.map((e) => [e.id, e]));
  const canon = (id: string) => canonical(byId, id);
  const people = new Map<string, TreePerson>();
  for (const e of src.entities) if (e.kind === "person" && canon(e.id) === e.id) people.set(e.id, e);

  // главы и годы — с учётом «это один человек»
  const chapters = new Map<string, Set<string>>();
  for (const e of src.entities) {
    if (e.kind !== "person") continue;
    const c = canon(e.id);
    const set = chapters.get(c) ?? new Set();
    for (const s of e.story_ids ?? []) set.add(s);
    chapters.set(c, set);
  }

  const storytellerOf = new Map<string, (typeof src.storytellers)[number]>();
  for (const st of src.storytellers) if (st.entity_id && byId.has(st.entity_id)) storytellerOf.set(canon(st.entity_id), st);
  const viewerSt =
    src.storytellers.find((s) => s.id === viewerStorytellerId && s.entity_id) ??
    [...src.storytellers].sort((a, b) => a.created_at.localeCompare(b.created_at)).find((s) => s.entity_id && byId.has(s.entity_id));
  const root = viewerSt?.entity_id ? canon(viewerSt.entity_id) : null;

  // рёбра без повторов
  const edges: TreeEdge[] = [];
  const familyTouched = new Set<string>();
  for (const r of src.relations) {
    const a = canon(r.from_entity_id);
    const b = canon(r.to_entity_id);
    if (a === b || !people.has(a) || !people.has(b)) continue;
    if (r.source === "family") (familyTouched.add(a), familyTouched.add(b));
    const dup = edges.some(
      (e) => e.kind === r.kind && ((e.from_entity_id === a && e.to_entity_id === b) || (r.kind !== "parent" && e.from_entity_id === b && e.to_entity_id === a)),
    );
    if (!dup) edges.push({ ...r, from_entity_id: a, to_entity_id: b });
  }

  // поколения: по рёбрам внутри связной части, части между собой — по словам родства
  const adj = new Map<string, { to: string; d: number }[]>();
  const link = (a: string, b: string, d: number) => {
    adj.set(a, [...(adj.get(a) ?? []), { to: b, d }]);
    adj.set(b, [...(adj.get(b) ?? []), { to: a, d: -d }]);
  };
  for (const e of edges) link(e.from_entity_id, e.to_entity_id, e.kind === "parent" ? 1 : 0);

  const rel = new Map<string, number>();
  const comp = new Map<string, number>();
  const order: string[] = [];
  const bfs = (start: string, ci: number) => {
    rel.set(start, 0);
    comp.set(start, ci);
    const q = [start];
    while (q.length) {
      const id = q.shift()!;
      order.push(id);
      for (const { to, d } of adj.get(id) ?? []) {
        if (comp.has(to)) continue;
        rel.set(to, rel.get(id)! + d);
        comp.set(to, ci);
        q.push(to);
      }
    }
  };
  let ci = 0;
  if (root && people.has(root)) bfs(root, ci++);
  for (const id of [...people.keys()].sort()) if (!comp.has(id)) bfs(id, ci++);

  const offset = new Map<number, number>();
  if (root && people.has(root)) offset.set(comp.get(root)!, 0);
  for (let changed = true; changed; ) {
    changed = false;
    for (const c of claims) {
      const p = canon(c.person);
      const n = canon(c.narrator);
      if (!comp.has(p) || !comp.has(n)) continue;
      const cp = comp.get(p)!;
      const cn = comp.get(n)!;
      if (offset.has(cp) || !offset.has(cn)) continue;
      offset.set(cp, offset.get(cn)! + rel.get(n)! + c.kin.gen - rel.get(p)!);
      changed = true;
    }
  }
  const rootComp = root ? comp.get(root) : undefined;

  // подписи от смотрящего
  const paths = root ? kinPaths(root, edges) : new Map<string, string>();
  const viewerGender = root ? (people.get(root)?.gender ?? null) : null;
  const claimOf = (id: string) => claims.find((c) => canon(c.person) === id && root && canon(c.narrator) === root);

  const makeNode = (id: string, gen: number, loose: boolean): TreeNode => {
    const e = people.get(id)!;
    const st = storytellerOf.get(id) ?? null;
    const kinOnly = isKinOnlyName(e.name_ru);
    let label = labelFor(paths.get(id), e.gender ?? null, viewerGender);
    if (!label && loose) {
      const c = claimOf(id);
      if (c) label = labelFor(ROLE_PATH[c.kin.role], e.gender ?? c.kin.gender, viewerGender);
    }
    const b = e.birth_year ?? st?.birth_year ?? null;
    const d = e.death_year ?? st?.death_year ?? null;
    return {
      id,
      name: kinOnly ? cap(label?.ru && !label.ru.startsWith("расск") ? label.ru : e.name_ru) : e.name_ru,
      nameKo: kinOnly ? (label?.ko ?? null) : (e.name_ko ?? st?.name_ko ?? null),
      realName: kinOnly ? null : e.name_ru,
      years: yearsText(b, d),
      birthYear: b,
      deathYear: d,
      gender: e.gender ?? null,
      label,
      storytellerId: st?.id ?? null,
      isViewer: id === root,
      loose,
      kinOnly,
      checked: familyTouched.has(id) || e.source === "family",
      gen,
      x: 0,
      y: 0,
      chapters: chapters.get(id)?.size ?? 0,
    };
  };

  const placed: TreeNode[] = [];
  const others: TreeNode[] = [];
  for (const id of order) {
    const c = comp.get(id)!;
    if (offset.has(c)) placed.push(makeNode(id, offset.get(c)! + rel.get(id)!, c !== rootComp));
    else if (!isKinOnlyName(people.get(id)!.name_ru)) others.push(makeNode(id, 0, true)); // «отец»-дубль без места — не показываем
  }
  // «учительница», «соседка» — без подписи родства; родня без рёбер — по слову
  for (const o of others) {
    if (o.label) continue;
    const e = people.get(o.id)!;
    o.label = e.description ? { ru: e.description.slice(0, 40), gen: e.description.slice(0, 40), ko: null } : null;
  }

  // ряды
  const gens = [...new Set(placed.map((n) => n.gen))].sort((a, b) => a - b);
  const node = new Map(placed.map((n) => [n.id, n]));
  const spouses = (id: string) =>
    edges.filter((e) => e.kind === "spouse" && (e.from_entity_id === id || e.to_entity_id === id)).map((e) => (e.from_entity_id === id ? e.to_entity_id : e.from_entity_id));
  const parentsOf = (id: string) => edges.filter((e) => e.kind === "parent" && e.to_entity_id === id && node.has(e.from_entity_id)).map((e) => e.from_entity_id);
  const childrenOf = (id: string) => edges.filter((e) => e.kind === "parent" && e.from_entity_id === id && node.has(e.to_entity_id)).map((e) => e.to_entity_id);
  const siblingsOf = (id: string) =>
    edges.filter((e) => e.kind === "sibling" && (e.from_entity_id === id || e.to_entity_id === id)).map((e) => (e.from_entity_id === id ? e.to_entity_id : e.from_entity_id));

  /** Единицы ряда: супруги вместе (мужчина слева, если известно), рассказчик со своей парой. */
  const units = (ids: string[]): string[][] => {
    const left = new Set(ids);
    const out: string[][] = [];
    for (const id of ids) {
      if (!left.has(id)) continue;
      const u = [id];
      left.delete(id);
      for (const s of spouses(id)) if (left.has(s)) (u.push(s), left.delete(s));
      if (u.length === 2 && node.get(u[0])?.gender === "f" && node.get(u[1])?.gender === "m" && !node.get(u[0])?.isViewer) u.reverse();
      out.push(u);
    }
    return out;
  };

  const rows = new Map<number, string[][]>();
  for (const g of gens) rows.set(g, units(placed.filter((n) => n.gen === g).map((n) => n.id)));

  // ряд рассказчика: братья и сёстры слева, рассказчик с парой в середине, остальные справа
  if (root && node.has(root)) {
    const g = node.get(root)!.gen;
    const list = rows.get(g)!;
    const ru = list.find((u) => u.includes(root))!;
    const sib = new Set([...siblingsOf(root), ...parentsOf(root).flatMap(childrenOf)]);
    const leftU = list.filter((u) => u !== ru && u.some((id) => sib.has(id)));
    const rightU = list.filter((u) => u !== ru && !leftU.includes(u));
    rows.set(g, [...leftU, ru, ...rightU]);
  }

  const step = CARD.w + CARD.gapX;
  const xs = new Map<string, number>();
  const avg = (ids: string[]) => {
    const v = ids.map((i) => xs.get(i)).filter((x): x is number => x !== undefined);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const placeRow = (g: string[][], wanted?: (u: string[]) => number | null) => {
    let list = g;
    if (wanted) {
      // у кого нет соседей в соседнем ряду — остаётся там, где стоял
      list = list.map((u) => ({ u, k: wanted(u) ?? avg(u) ?? 0 })).sort((a, b) => a.k - b.k).map((k) => k.u);
    }
    const flat = list.flat();
    const start = -((flat.length - 1) * step) / 2;
    flat.forEach((id, i) => xs.set(id, start + i * step));
    return list;
  };
  const rootGen = root && node.has(root) ? node.get(root)!.gen : null;
  for (const g of gens) rows.set(g, placeRow(rows.get(g)!));
  for (let it = 0; it < 3; it++) {
    for (const g of gens) if (g !== rootGen) rows.set(g, placeRow(rows.get(g)!, (u) => avg(u.flatMap(parentsOf))));
    for (const g of [...gens].reverse()) if (g !== rootGen) rows.set(g, placeRow(rows.get(g)!, (u) => avg(u.flatMap(childrenOf))));
  }

  // ряд целиком — под своими родителями (ниже рассказчика) / над детьми (выше): сын — под серединой пары
  const centerOn = (g: number, near: (id: string) => string[]) => {
    const ids = rows.get(g)!.flat();
    const pairs = ids.map((id) => ({ x: xs.get(id)!, want: near(id).map((n) => xs.get(n)).filter((v): v is number => v !== undefined) })).filter((p) => p.want.length);
    if (!pairs.length) return;
    const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    const shift = mean(pairs.map((p) => mean(p.want))) - mean(pairs.map((p) => p.x));
    for (const id of ids) xs.set(id, xs.get(id)! + shift);
  };
  if (rootGen !== null) {
    for (const g of gens.filter((x) => x > rootGen)) centerOn(g, parentsOf);
    for (const g of gens.filter((x) => x < rootGen).reverse()) centerOn(g, childrenOf);
  }

  const minX = Math.min(...[...xs.values()]);
  const maxX = Math.max(...[...xs.values()]);
  const minGen = gens[0] ?? 0;
  for (const n of placed) {
    n.x = xs.get(n.id)! - minX + CARD.pad;
    n.y = (n.gen - minGen) * (CARD.h + CARD.gapY) + CARD.pad;
  }
  const width = placed.length ? maxX - minX + CARD.w + CARD.pad * 2 : 0;
  const height = gens.length ? gens.length * CARD.h + (gens.length - 1) * CARD.gapY + CARD.pad * 2 : 0;

  // линии
  const lines: TreeLine[] = [];
  const couples: [string, string][] = [];
  const midY = (n: TreeNode) => n.y + 46; // на уровне кружка с фото
  for (const e of edges.filter((x) => x.kind === "spouse")) {
    const a = node.get(e.from_entity_id);
    const b = node.get(e.to_entity_id);
    if (!a || !b || a.gen !== b.gen || Math.abs(a.x - b.x) > step + 1) continue;
    const [l, r] = a.x < b.x ? [a, b] : [b, a];
    couples.push([l.id, r.id]);
    lines.push({ kind: "spouse", d: `M${l.x + CARD.w} ${midY(l)}H${r.x}` });
  }
  const groups = new Map<string, string[]>();
  for (const n of placed) {
    const ps = [...new Set(parentsOf(n.id))].sort();
    if (!ps.length) continue;
    const k = ps.join("|");
    groups.set(k, [...(groups.get(k) ?? []), n.id]);
  }
  for (const [k, kids] of groups) {
    const ps = k.split("|").map((id) => node.get(id)!);
    const pair = ps.length === 2 && ps[0].gen === ps[1].gen && Math.abs(ps[0].x - ps[1].x) <= step + 1;
    const sx = pair ? (ps[0].x + ps[1].x) / 2 + CARD.w / 2 : ps[0].x + CARD.w / 2;
    const sy = pair ? midY(ps[0]) : ps[0].y + CARD.h;
    const ch = kids.map((id) => node.get(id)!);
    const top = Math.min(...ch.map((c) => c.y));
    const bus = top - CARD.gapY / 2;
    const cxs = ch.map((c) => c.x + CARD.w / 2);
    let d = `M${sx} ${sy}V${bus}`;
    const lo = Math.min(sx, ...cxs);
    const hi = Math.max(sx, ...cxs);
    if (hi > lo) d += `M${lo} ${bus}H${hi}`;
    for (const c of ch) d += `M${c.x + CARD.w / 2} ${bus}V${c.y}`;
    lines.push({ kind: "child", d });
  }
  for (const e of edges.filter((x) => x.kind === "sibling")) {
    const a = node.get(e.from_entity_id);
    const b = node.get(e.to_entity_id);
    if (!a || !b || a.gen !== b.gen) continue;
    if (parentsOf(a.id).length && parentsOf(b.id).length) continue; // уже соединены через родителей
    const y = a.y - 14;
    lines.push({ kind: "sibling", d: `M${a.x + CARD.w / 2} ${a.y}V${y}H${b.x + CARD.w / 2}V${b.y}` });
  }

  return {
    viewer: root,
    nodes: placed,
    lines,
    rows: gens.map((g) => ({ gen: g, y: (g - minGen) * (CARD.h + CARD.gapY) + CARD.pad, ids: rows.get(g)!.flat() })),
    width,
    height,
    others: others.sort((a, b) => a.name.localeCompare(b.name, "ru")),
    couples,
  };
}
