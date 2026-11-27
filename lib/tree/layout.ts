// #235 → #277 древо 2.0: раскладка — поколения рядами сверху вниз, рассказчик с парой в центре своего ряда,
// супруги — одной «капсулой», дети — линией от пары, у больших семей ветки «сбоку» свёрнуты («+ ещё 6»).
// Чистая функция: и для страницы /f/<токен>/tree (SVG-линии + карточки + список), и для страницы древа в PDF.
import type { TreeGender } from "@/lib/types";
import { canonical, type Claim, type TreeEdge, type TreePerson, type TreeSource } from "./build";
import { isKinOnlyName } from "./kinship";
import { kinPaths, labelFor, type KinLabel } from "./labels";

/**
 * Размеры (px). Карточка 128 × 164: фото 40, имя до 2 строк (длинное — до 3 строк мельче), имя по-корейски, годы, роль — с запасом по высоте
 * (Safari центрирует содержимое кнопки по вертикали: не влезло — режется и сверху, #277).
 * couple — зазор внутри пары, capsule — поле капсулы вокруг пары, gapX — между капсулами / людьми ряда,
 * label — полоса подписи ряда над карточками, gapY — от низа ряда до полосы подписи следующего.
 */
export const CARD = { w: 128, h: 164, couple: 10, capsule: 6, gapX: 22, gapY: 76, label: 30, pad: 16, chipW: 112, chipH: 48 };

/** Сколько людей показываем сразу; больше — ветки «сбоку» сворачиваются (#277). */
export const COLLAPSE_AT = 24;

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
  /** Поколение относительно смотрящего: −1 родители, 0 его ряд, 1 дети; нет смотрящего — null */
  rel: number | null;
  x: number;
  y: number;
  chapters: number;
  /** Главы, где человек упоминается (с учётом «это один человек») */
  storyIds: string[];
  /** Путь фото в бакете photos: своё фото человека (#269), иначе фото рассказчика */
  photo: string | null;
  /** Своё фото человека древа (можно убрать); фото рассказчика с /start здесь нет */
  ownPhoto: boolean;
  /** Место рождения (известно у рассказчика) */
  place: string | null;
}

export interface TreeLine {
  kind: "child" | "sibling";
  d: string;
}

export interface TreeRow {
  gen: number;
  rel: number | null;
  /** Верх полосы подписи ряда */
  y: number;
  /** Все люди ряда слева направо (видимые) */
  ids: string[];
  /** Капсулы ряда: пара / один человек / человек с двумя браками */
  units: string[][];
}

export interface TreeCapsule {
  ids: [string, string];
  x: number;
  y: number;
  w: number;
  h: number;
  /** Человек в двух браках — капсулы рисуем рамкой без заливки (пересекаются на нём) */
  outline: boolean;
}

/** «+ ещё N» под человеком, чьи потомки свёрнуты */
export interface TreeChip {
  owner: string;
  count: number;
  x: number;
  y: number;
}

export interface TreeModel {
  viewer: string | null;
  /** Видимые на древе */
  nodes: TreeNode[];
  /** Свёрнутые ветки (вид «Списком» показывает и их) */
  hidden: TreeNode[];
  chips: TreeChip[];
  lines: TreeLine[];
  capsules: TreeCapsule[];
  rows: TreeRow[];
  width: number;
  height: number;
  /** Рамка капсулы смотрящего — «⌖ к рассказчику» ставит её в центр */
  focus: { x: number; y: number; w: number; h: number } | null;
  /** Пара рассказчика с родителями и детьми, потом только с родителями — при открытии берём первую, что влезает в окно */
  homes: { x: number; y: number; w: number; h: number }[];
  /** Люди из рассказов без родства («учительница», «соседка») — не на древе */
  others: TreeNode[];
  /** Супруги, стоящие рядом (левый, правый) */
  couples: [string, string][];
}

export interface LayoutOptions {
  /**
   * Сворачивать ветки «сбоку», если людей больше COLLAPSE_AT. open — чьи ветки развёрнуты (id человека), "all" — все.
   * Не задано — без свёртки (PDF, тесты).
   */
  collapse?: { open: string[] | "all" };
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

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function layoutTree(src: TreeSource, claims: Claim[], viewerStorytellerId?: string | null, opts: LayoutOptions = {}): TreeModel {
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
    if (r.source === "family") {
      familyTouched.add(a);
      familyTouched.add(b);
    }
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

  const storyIdsOf = (id: string) => [...(chapters.get(id) ?? [])];

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
    const ids = storyIdsOf(id);
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
      rel: null,
      x: 0,
      y: 0,
      chapters: ids.length,
      storyIds: ids,
      photo: e.photo_url ?? st?.photo_url ?? null,
      ownPhoto: Boolean(e.photo_url),
      place: st?.birth_place ?? null,
    };
  };

  const all: TreeNode[] = [];
  const others: TreeNode[] = [];
  for (const id of order) {
    const c = comp.get(id)!;
    if (offset.has(c)) all.push(makeNode(id, offset.get(c)! + rel.get(id)!, c !== rootComp));
    else if (!isKinOnlyName(people.get(id)!.name_ru)) others.push(makeNode(id, 0, true)); // «отец»-дубль без места — не показываем
  }
  // «учительница», «соседка» — без подписи родства; родня без рёбер — по слову
  for (const o of others) {
    if (o.label) continue;
    const e = people.get(o.id)!;
    o.label = e.description ? { ru: e.description.slice(0, 40), gen: e.description.slice(0, 40), ko: null } : null;
  }
  const rootNode = all.find((n) => n.isViewer) ?? null;
  for (const n of all) n.rel = rootNode ? n.gen - rootNode.gen : null;

  // связи между людьми древа
  const inTree = new Set(all.map((n) => n.id));
  const spousesAll = (id: string) =>
    edges.filter((e) => e.kind === "spouse" && (e.from_entity_id === id || e.to_entity_id === id)).map((e) => (e.from_entity_id === id ? e.to_entity_id : e.from_entity_id)).filter((x) => inTree.has(x));
  const parentsAll = (id: string) => edges.filter((e) => e.kind === "parent" && e.to_entity_id === id && inTree.has(e.from_entity_id)).map((e) => e.from_entity_id);
  const childrenAll = (id: string) => edges.filter((e) => e.kind === "parent" && e.from_entity_id === id && inTree.has(e.to_entity_id)).map((e) => e.to_entity_id);
  const siblingsAll = (id: string) =>
    edges.filter((e) => e.kind === "sibling" && (e.from_entity_id === id || e.to_entity_id === id)).map((e) => (e.from_entity_id === id ? e.to_entity_id : e.from_entity_id)).filter((x) => inTree.has(x));

  // ---------------- свёртка веток «сбоку» (#277) ----------------
  const hiddenIds = new Set<string>();
  const chipCount = new Map<string, number>();
  if (opts.collapse && opts.collapse.open !== "all" && rootNode && all.length > COLLAPSE_AT) {
    const open = new Set(opts.collapse.open);
    const walk = (start: string[], next: (id: string) => string[]) => {
      const seen = new Set<string>();
      const q = [...start];
      while (q.length) {
        const id = q.shift()!;
        for (const n of next(id)) {
          if (seen.has(n)) continue;
          seen.add(n);
          q.push(n);
        }
      }
      return seen;
    };
    // прямая линия: рассказчик, его предки и потомки и их супруги — всегда на виду
    const direct = new Set([root!, ...walk([root!], parentsAll), ...walk([root!], childrenAll)]);
    const core = new Set(direct);
    for (const id of direct) for (const s of spousesAll(id)) core.add(s);
    // хозяева веток: братья и сёстры людей прямой линии (дети её людей, сами не на линии) — видны, их потомки свёрнуты
    const owners = all
      .map((n) => n.id)
      .filter((id) => !core.has(id) && (parentsAll(id).some((p) => core.has(p)) || siblingsAll(id).some((s) => direct.has(s))));
    for (const owner of owners) {
      if (open.has(owner)) continue;
      const branch = new Set<string>();
      for (const d of walk([owner], childrenAll)) {
        if (core.has(d) || d === owner) continue;
        branch.add(d);
        for (const s of spousesAll(d)) if (!core.has(s) && s !== owner) branch.add(s);
      }
      if (!branch.size) continue;
      for (const id of branch) hiddenIds.add(id);
      chipCount.set(owner, branch.size);
    }
    for (const owner of [...chipCount.keys()]) if (hiddenIds.has(owner)) chipCount.delete(owner); // хозяин сам в чужой ветке — её чип за всех
  }
  const placed = all.filter((n) => !hiddenIds.has(n.id));
  const hidden = all.filter((n) => hiddenIds.has(n.id));

  // ---------------- ряды ----------------
  const gens = [...new Set(placed.map((n) => n.gen))].sort((a, b) => a - b);
  const node = new Map(placed.map((n) => [n.id, n]));
  const vis = (ids: string[]) => ids.filter((x) => node.has(x));
  const spouses = (id: string) => vis(spousesAll(id));
  const parentsOf = (id: string) => vis(parentsAll(id));
  const childrenOf = (id: string) => vis(childrenAll(id));

  /** Капсулы ряда: человек с супругами (мужчина слева, если известно; два брака — человек в середине). */
  const units = (ids: string[]): string[][] => {
    const left = new Set(ids);
    const out: string[][] = [];
    for (const id of ids) {
      if (!left.has(id)) continue;
      left.delete(id);
      const sp = spouses(id).filter((s) => left.has(s));
      for (const s of sp) left.delete(s);
      let u: string[] = [id];
      if (sp.length >= 2) u = [sp[0]!, id, ...sp.slice(1)];
      else if (sp.length === 1) u = node.get(id)!.gender === "f" && node.get(sp[0]!)!.gender !== "f" ? [sp[0]!, id] : [id, sp[0]!];
      out.push(u);
    }
    return out;
  };

  const rows = new Map<number, string[][]>();
  for (const g of gens) rows.set(g, units(placed.filter((n) => n.gen === g).map((n) => n.id)));

  // ряд рассказчика: братья и сёстры слева (старшие левее), рассказчик с парой, остальные справа
  const rootGen = rootNode && node.has(rootNode.id) ? rootNode.gen : null;
  if (rootGen !== null) {
    const list = rows.get(rootGen)!;
    const ru = list.find((u) => u.includes(root!))!;
    const sib = new Set([...vis(siblingsAll(root!)), ...parentsOf(root!).flatMap(childrenOf)]);
    const byBirth = (a: string[], b: string[]) => (node.get(a[0]!)!.birthYear ?? 9999) - (node.get(b[0]!)!.birthYear ?? 9999);
    const leftU = list.filter((u) => u !== ru && u.some((id) => sib.has(id))).sort(byBirth);
    const rightU = list.filter((u) => u !== ru && !leftU.includes(u));
    rows.set(rootGen, [...leftU, ru, ...rightU]);
  }

  const unitW = (u: string[]) => u.length * CARD.w + (u.length - 1) * CARD.couple;
  const left = new Map<string, number>(); // левый край карточки
  const center = (id: string) => left.get(id)! + CARD.w / 2;
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const placeUnit = (u: string[], x0: number) => u.forEach((id, i) => left.set(id, x0 + i * (CARD.w + CARD.couple)));

  /** Ряд по желаемым центрам капсул: без наложений, порядок по желанию; кому нечего хотеть — следом за соседом. */
  const arrange = (g: number, want: (u: string[]) => number | null) => {
    const items = rows.get(g)!.map((u, i) => ({ u, i, w: unitW(u), want: want(u) }));
    const order = [...items.filter((it) => it.want !== null).sort((a, b) => a.want! - b.want! || a.i - b.i), ...items.filter((it) => it.want === null)];
    let right = -Infinity;
    const lefts: number[] = [];
    for (const it of order) {
      const after = right === -Infinity ? -Infinity : right + CARD.gapX;
      const x = it.want !== null ? Math.max(it.want - it.w / 2, after) : after === -Infinity ? 0 : after;
      lefts.push(x);
      right = x + it.w;
    }
    const dev = order.map((it, k) => (it.want !== null ? it.want - (lefts[k]! + it.w / 2) : null)).filter((v): v is number => v !== null);
    const shift = dev.length ? mean(dev) : -(right + (lefts[0] ?? 0)) / 2; // никого не тянет — ряд по центру
    order.forEach((it, k) => placeUnit(it.u, lefts[k]! + shift));
    rows.set(g, order.map((it) => it.u));
  };
  const packCentered = (g: number, anchor?: string[]) => {
    const list = rows.get(g)!;
    let x = 0;
    for (const u of list) {
      placeUnit(u, x);
      x += unitW(u) + CARD.gapX;
    }
    const a = anchor ? mean(anchor.map(center)) : (x - CARD.gapX) / 2;
    for (const u of list) for (const id of u) left.set(id, left.get(id)! - a);
  };
  const wantFrom = (near: (id: string) => string[]) => (u: string[]) => {
    const xs = u.flatMap(near).filter((id) => left.has(id)).map(center);
    return xs.length ? mean(xs) : null;
  };

  // предки встают над своим ребёнком на прямой линии (родители — над рассказчиком, а не над серединой всех детей)
  const lineUp = new Set<string>();
  if (rootGen !== null) {
    const q = [root!];
    while (q.length) {
      for (const p of parentsOf(q.shift()!)) {
        if (lineUp.has(p)) continue;
        lineUp.add(p);
        q.push(p);
      }
    }
  }
  const wantUp = (u: string[]) => {
    const kids = u.flatMap(childrenOf).filter((id) => left.has(id));
    const line = u.some((id) => lineUp.has(id)) ? kids.filter((id) => id === root || lineUp.has(id)) : [];
    const use = line.length ? line : kids;
    return use.length ? mean(use.map(center)) : null;
  };
  if (rootGen !== null) {
    packCentered(rootGen, rows.get(rootGen)!.find((u) => u.includes(root!)));
    for (const g of gens.filter((x) => x < rootGen).reverse()) arrange(g, wantUp);
    for (const g of gens.filter((x) => x > rootGen)) arrange(g, wantFrom(parentsOf));
    // предки ещё раз — по детям, которые теперь стоят на своих местах (тёти рядом с двоюродными)
    for (const g of gens.filter((x) => x < rootGen).reverse()) arrange(g, wantUp);
  } else if (gens.length) {
    packCentered(gens[0]!);
    for (const g of gens.slice(1)) arrange(g, wantFrom(parentsOf));
  }

  // ---------------- координаты ----------------
  const rowStride = CARD.label + CARD.h + CARD.gapY;
  const minGen = gens[0] ?? 0;
  const owners = [...chipCount.keys()].filter((o) => node.has(o));
  const xs = placed.flatMap((n) => [left.get(n.id)! - CARD.capsule, left.get(n.id)! + CARD.w + CARD.capsule]);
  for (const o of owners) xs.push(left.get(o)! + CARD.w / 2 - CARD.chipW / 2, left.get(o)! + CARD.w / 2 + CARD.chipW / 2);
  const minX = xs.length ? Math.min(...xs) : 0;
  const maxX = xs.length ? Math.max(...xs) : 0;
  const rowTop = (g: number) => CARD.pad + (g - minGen) * rowStride;
  for (const n of placed) {
    n.x = Math.round(left.get(n.id)! - minX + CARD.pad);
    n.y = rowTop(n.gen) + CARD.label;
  }

  const lines: TreeLine[] = [];
  const couples: [string, string][] = [];
  const capsules: TreeCapsule[] = [];
  const unitOf = new Map<string, string[]>();
  for (const g of gens) for (const u of rows.get(g)!) for (const id of u) unitOf.set(id, u);
  for (const g of gens) {
    for (const u of rows.get(g)!) {
      for (let i = 0; i + 1 < u.length; i++) {
        const l = node.get(u[i]!)!;
        const r = node.get(u[i + 1]!)!;
        couples.push([l.id, r.id]);
        capsules.push({
          ids: [l.id, r.id],
          x: l.x - CARD.capsule,
          y: l.y - CARD.capsule,
          w: r.x + CARD.w - l.x + CARD.capsule * 2,
          h: CARD.h + CARD.capsule * 2,
          outline: u.length > 2,
        });
      }
    }
  }

  // дети — от пары (середина капсулы) или от одного родителя
  const bottom = (n: TreeNode) => n.y + CARD.h + (unitOf.get(n.id)!.length > 1 ? CARD.capsule : 0);
  const groups = new Map<string, string[]>();
  for (const n of placed) {
    const ps = [...new Set(parentsOf(n.id))].sort();
    if (!ps.length) continue;
    const k = ps.join("|");
    groups.set(k, [...(groups.get(k) ?? []), n.id]);
  }
  const busCount = new Map<number, number>();
  for (const [k, kids] of groups) {
    const ps = k.split("|").map((id) => node.get(id)!);
    const p0 = ps[0]!;
    const p1 = ps[1];
    const u = unitOf.get(p0.id)!;
    const together = !!p1 && ps.length === 2 && u.includes(p1.id) && Math.abs(u.indexOf(p0.id) - u.indexOf(p1.id)) === 1;
    let sx: number;
    if (together) {
      const [l, r] = p0.x < p1!.x ? [p0, p1!] : [p1!, p0];
      sx = (l.x + CARD.w + r.x) / 2;
    } else sx = p0.x + CARD.w / 2;
    const sy = bottom(p0);
    const ch = kids.map((id) => node.get(id)!);
    const childTop = Math.min(...ch.map((c) => c.y));
    const g = Math.min(...ch.map((c) => c.gen));
    const nth = busCount.get(g) ?? 0;
    busCount.set(g, nth + 1);
    const bus = Math.round((sy + childTop - CARD.label) / 2 + ((nth % 3) - 1) * 6);
    const cxs = ch.map((c) => c.x + CARD.w / 2);
    let d = `M${sx} ${sy}V${bus}`;
    const lo = Math.min(sx, ...cxs);
    const hi = Math.max(sx, ...cxs);
    if (hi > lo) d += `M${lo} ${bus}H${hi}`;
    for (const c of ch) d += `M${c.x + CARD.w / 2} ${bus}V${c.y - (unitOf.get(c.id)!.length > 1 ? CARD.capsule : 0)}`;
    lines.push({ kind: "child", d });
  }
  for (const e of edges.filter((x) => x.kind === "sibling")) {
    const a = node.get(e.from_entity_id);
    const b = node.get(e.to_entity_id);
    if (!a || !b || a.gen !== b.gen) continue;
    if (parentsOf(a.id).length && parentsOf(b.id).length) continue; // уже соединены через родителей
    const y = a.y - CARD.capsule - 8;
    lines.push({ kind: "sibling", d: `M${a.x + CARD.w / 2} ${a.y - CARD.capsule}V${y}H${b.x + CARD.w / 2}V${b.y - CARD.capsule}` });
  }

  const chips: TreeChip[] = owners.map((owner) => {
    const n = node.get(owner)!;
    return { owner, count: chipCount.get(owner)!, x: Math.round(n.x + CARD.w / 2 - CARD.chipW / 2), y: bottom(n) + 10 };
  });

  const width = placed.length ? Math.round(maxX - minX + CARD.pad * 2) : 0;
  const lowest = Math.max(0, ...placed.map((n) => n.y + CARD.h + CARD.capsule), ...chips.map((c) => c.y + CARD.chipH));
  const height = placed.length ? lowest + CARD.pad : 0;

  const viewerUnit = root && node.has(root) ? unitOf.get(root)! : null;
  const focus = viewerUnit
    ? (() => {
        const ns = viewerUnit.map((id) => node.get(id)!);
        const x = Math.min(...ns.map((n) => n.x)) - CARD.capsule;
        return { x, y: ns[0]!.y - CARD.capsule, w: Math.max(...ns.map((n) => n.x)) + CARD.w + CARD.capsule - x, h: CARD.h + CARD.capsule * 2 };
      })()
    : null;

  // «дом» при открытии: пара рассказчика + родители (+ дети) — показываем вместе, если влезают в окно
  const around = (ids: string[]) => {
    if (!focus) return null;
    const near = ids.map((id) => node.get(id)).filter((n): n is TreeNode => !!n);
    if (!near.length) return null;
    const xs = [focus.x, focus.x + focus.w, ...near.flatMap((n) => [n.x - CARD.capsule, n.x + CARD.w + CARD.capsule])];
    const ys = [focus.y, focus.y + focus.h, ...near.flatMap((n) => [n.y - CARD.label, n.y + CARD.h + CARD.capsule])];
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  };
  const up = root ? [...parentsOf(root), ...spouses(root).flatMap(parentsOf)] : [];
  const homes = [around([...up, ...(root ? childrenOf(root) : [])]), around(up)].filter((b): b is NonNullable<typeof b> => !!b);

  return {
    viewer: root,
    homes,
    nodes: placed,
    hidden,
    chips,
    lines,
    capsules,
    rows: gens.map((g) => {
      const us = rows.get(g)!;
      return { gen: g, rel: rootNode ? g - rootNode.gen : null, y: rowTop(g), ids: us.flat(), units: us };
    }),
    width,
    height,
    focus,
    others: others.sort((a, b) => a.name.localeCompare(b.name, "ru")),
    couples,
  };
}
