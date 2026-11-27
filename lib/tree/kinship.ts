// #235 древо семьи: слова родства → роль относительно рассказчика главы. Без ИИ: только то, что уже сказали
// facts.relation (шаг edit) и словарь семьи (#102). Общий русский + слои пакетов: корё мар (koryo), казахский (kz).
import type { TreeGender } from "@/lib/types";

export type KinRole =
  | "parent"
  | "child"
  | "spouse"
  | "sibling"
  | "grandparent"
  | "grandchild"
  | "greatgrandparent"
  | "auntuncle"
  | "nephew"
  | "cousin"
  | "parentInLaw"
  | "childInLaw";

export type KinSide = "mother" | "father";

export interface Kin {
  role: KinRole;
  gender: TreeGender | null;
  side: KinSide | null;
  /** Поколение относительно рассказчика: −1 родители, +1 дети… */
  gen: number;
  /** Как назвать человека, если имени нет: «отец», «мама»… */
  ru: string;
}

const GEN: Record<KinRole, number> = {
  parent: -1,
  child: 1,
  spouse: 0,
  sibling: 0,
  grandparent: -2,
  grandchild: 2,
  greatgrandparent: -3,
  auntuncle: -1,
  nephew: 1,
  cousin: 0,
  parentInLaw: -1,
  childInLaw: 1,
};

type Term = [word: string, role: KinRole, gender: TreeGender | null, side?: KinSide];

/**
 * Слова родства. Порядок важен: составные («двоюродный брат», «нағашы ата») — раньше простых.
 * Слово ищется целиком (без окончаний, кроме перечисленных форм): «брат» ≠ «братство».
 */
const TERMS: Term[] = [
  // составные
  ["двоюродный брат", "cousin", "m"],
  ["двоюродная сестра", "cousin", "f"],
  ["нағашы ата", "grandparent", "m", "mother"],
  ["нагашы ата", "grandparent", "m", "mother"],
  ["нағашы әже", "grandparent", "f", "mother"],
  ["нагашы аже", "grandparent", "f", "mother"],
  ["нағашы апа", "grandparent", "f", "mother"],
  ["нагашы апа", "grandparent", "f", "mother"],
  // прадеды
  ["прадедушка", "greatgrandparent", "m"],
  ["прадед", "greatgrandparent", "m"],
  ["прабабушка", "greatgrandparent", "f"],
  ["прабабка", "greatgrandparent", "f"],
  // деды
  ["дедушка", "grandparent", "m"],
  ["дедуля", "grandparent", "m"],
  ["дед", "grandparent", "m"],
  ["бабушка", "grandparent", "f"],
  ["бабуля", "grandparent", "f"],
  ["бабка", "grandparent", "f"],
  ["харабоджи", "grandparent", "m"],
  ["харабай", "grandparent", "m"],
  ["хальабай", "grandparent", "m"],
  ["хальмони", "grandparent", "f"],
  ["халмони", "grandparent", "f"],
  ["хальмэ", "grandparent", "f"],
  ["хальмай", "grandparent", "f"],
  ["ата", "grandparent", "m"],
  ["әже", "grandparent", "f"],
  ["аже", "grandparent", "f"],
  // родители
  ["отец", "parent", "m"],
  ["отца", "parent", "m"],
  ["папа", "parent", "m"],
  ["батя", "parent", "m"],
  ["аппади", "parent", "m"],
  ["аппай", "parent", "m"],
  ["абоди", "parent", "m"],
  ["әке", "parent", "m"],
  ["аке", "parent", "m"],
  ["мать", "parent", "f"],
  ["матери", "parent", "f"],
  ["мама", "parent", "f"],
  ["мамо", "parent", "f"],
  ["омани", "parent", "f"],
  ["оммани", "parent", "f"],
  ["аммони", "parent", "f"],
  ["омай", "parent", "f"],
  ["ана", "parent", "f"],
  ["шеше", "parent", "f"],
  // свойство
  ["свекровь", "parentInLaw", "f"],
  ["свекор", "parentInLaw", "m"],
  ["теща", "parentInLaw", "f"],
  ["тесть", "parentInLaw", "m"],
  ["невестка", "childInLaw", "f"],
  ["сноха", "childInLaw", "f"],
  ["зять", "childInLaw", "m"],
  // супруги
  ["муж", "spouse", "m"],
  ["супруг", "spouse", "m"],
  ["жена", "spouse", "f"],
  ["супруга", "spouse", "f"],
  ["күйеу", "spouse", "m"],
  ["әйел", "spouse", "f"],
  // братья и сёстры
  ["брат", "sibling", "m"],
  ["братишка", "sibling", "m"],
  ["сестра", "sibling", "f"],
  ["сестренка", "sibling", "f"],
  ["аға", "sibling", "m"],
  ["іні", "sibling", "m"],
  ["сіңлі", "sibling", "f"],
  ["қарындас", "sibling", "f"],
  // дети и внуки
  ["сын", "child", "m"],
  ["сынок", "child", "m"],
  ["дочь", "child", "f"],
  ["дочка", "child", "f"],
  ["ұл", "child", "m"],
  ["внук", "grandchild", "m"],
  ["внучка", "grandchild", "f"],
  ["немере", "grandchild", null],
  // дяди и племянники
  ["дядя", "auntuncle", "m"],
  ["тетя", "auntuncle", "f"],
  ["племянник", "nephew", "m"],
  ["племянница", "nephew", "f"],
];

/** Как назвать человека без имени по роли и полу. */
const PLAIN: Record<KinRole, { f: string; m: string; x: string }> = {
  parent: { f: "мама", m: "отец", x: "родитель" },
  child: { f: "дочь", m: "сын", x: "ребёнок" },
  spouse: { f: "жена", m: "муж", x: "супруг" },
  sibling: { f: "сестра", m: "брат", x: "брат или сестра" },
  grandparent: { f: "бабушка", m: "дедушка", x: "дедушка или бабушка" },
  grandchild: { f: "внучка", m: "внук", x: "внук" },
  greatgrandparent: { f: "прабабушка", m: "прадедушка", x: "прадед" },
  auntuncle: { f: "тётя", m: "дядя", x: "дядя или тётя" },
  nephew: { f: "племянница", m: "племянник", x: "племянник" },
  cousin: { f: "двоюродная сестра", m: "двоюродный брат", x: "двоюродный брат" },
  parentInLaw: { f: "свекровь", m: "свёкор", x: "родитель супруга" },
  childInLaw: { f: "невестка", m: "зять", x: "зять или невестка" },
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"“”().,;:!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const MOTHER_SIDE = /(по (маме|матери|материнской)|материн|нағашы|нагашы)/;
const FATHER_SIDE = /(по (папе|отцу|отцовской)|отцовск)/;

function wordAt(text: string, word: string): number {
  const w = norm(word);
  const m = new RegExp(`(^|[^\\p{L}])(${w})(?=$|[^\\p{L}])`, "u").exec(text);
  return m ? m.index + m[1].length : -1;
}

/**
 * Слово родства в тексте («мать», «дед по маме», «нағашы ата», «жена, бабушка внуков») → роль. Берётся слово, которое
 * стоит раньше (при равенстве — длиннее): «жена, бабушка внуков» — жена. Не родство («сосед», «учительница») → null.
 */
export function parseKin(text: string | null | undefined): Kin | null {
  if (!text) return null;
  const t = norm(text);
  if (!t) return null;
  let best: { at: number; len: number; term: Term } | null = null;
  for (const term of TERMS) {
    const at = wordAt(t, term[0]);
    if (at < 0) continue;
    if (!best || at < best.at || (at === best.at && term[0].length > best.len)) best = { at, len: term[0].length, term };
  }
  if (!best) return null;
  const [, role, gender, side] = best.term;
  const s: KinSide | null = side ?? (MOTHER_SIDE.test(t) ? "mother" : FATHER_SIDE.test(t) ? "father" : null);
  const p = PLAIN[role];
  return { role, gender, side: s, gen: GEN[role], ru: gender ? p[gender] : p.x };
}

const TERM_WORDS = new Set(TERMS.flatMap(([w]) => norm(w).split(" ")));
const FILLER = new Set(["по", "маме", "матери", "материнской", "папе", "отцу", "отцовской", "мой", "моя", "наш", "наша", "родной", "родная", "старший", "старшая", "младший", "младшая", "покойный", "покойная"]);

/** Имя — это само слово родства («отец», «мама», «омани», «дед по маме»): у такого человека на древе пока нет имени. */
export function isKinOnlyName(name: string): boolean {
  const t = norm(name);
  if (!parseKin(t)) return false;
  return t.split(" ").every((w) => TERM_WORDS.has(w) || FILLER.has(w));
}

export function plainName(role: KinRole, gender: TreeGender | null): string {
  const p = PLAIN[role];
  return gender ? p[gender] : p.x;
}

export function kinGen(role: KinRole): number {
  return GEN[role];
}
