// #155: одно написание имён в УЖЕ готовых главах — пакетный проход без ИИ (scripts/spellings-backfill.ts).
// Поправка по словарю (#121 #124, lib/pipeline/names.ts) срабатывает только при новом переводе: главы, переведённые
// раньше, могут писать одно имя по-разному (렌나 / 레나). Здесь, по каждой семье:
//   1) для людей и мест словаря ищем корейские варианты имени в готовых главах — без ИИ, по близости к «якорю»:
//      написание из словаря (name_ko) и транслитерация русского имени (hangulizeRu); сравнение по чамо (ㄹ ㅔ ㄴ ㅏ);
//   2) победитель — написание словаря (правка семьи #104 важнее всего), иначе самый частый вариант (при равенстве —
//      из более ранней главы); пустой name_ko заполняется победителем;
//   3) остальные варианты меняются на победителя в text_ko / title_ko / quote_ko (целое слово, частицы сохраняются).
// Осторожность важнее полноты — пропустить вариант лучше, чем испортить обычное слово:
//   - вариант засчитывается только в главе, где имя есть в русском тексте, и не чаще, чем оно там упомянуто (+1);
//   - вариант, который встречается в главе БЕЗ этого имени в русском, — обычное слово, не трогаем нигде;
//   - вариант, одинаково близкий к двум именам словаря, не трогаем; имена короче двух слогов не трогаем.
// Слова корё мар не трогаем: 아버지 / 국수 — общие слова (#138). Чистые функции; запись — в скрипте.
import { KO_PARTICLES, countRu, replaceKo } from "@/lib/entities/replace";
import type { FamilyEntity } from "@/lib/types";
import { hangulizeRu } from "./cyrillic";
import { validKo } from "./names";

export type SpellingEntity = Pick<FamilyEntity, "id" | "kind" | "name_ru" | "name_ko" | "source">;

export interface SpellingChapter {
  id: string;
  created_at: string;
  title: string | null;
  quote: string | null;
  text_ru: string | null;
  title_ko: string | null;
  quote_ko: string | null;
  text_ko: string | null;
}

export interface EntityPlan {
  id: string;
  kind: SpellingEntity["kind"];
  /** Написание для всей книги */
  to: string;
  /** Записать в словарь (name_ko был пуст) */
  learn: boolean;
  /** Варианты, которые меняются на to: сколько раз встретились */
  variants: { ko: string; count: number }[];
  /** Глав, где что-то заменено */
  chapters: number;
  /** Главы, где замену пропустили из осторожности (вариантов больше, чем упоминаний в русском) */
  skipped: number;
}

export interface ChapterPatch {
  id: string;
  title_ko: string | null;
  quote_ko: string | null;
  text_ko: string | null;
  replaced: number;
}

export interface SpellingPlan {
  entities: EntityPlan[];
  chapters: ChapterPatch[];
}

/** Порог похожести по чамо (1 — совпадает). 레나 / 렌나 = 0.8, 레나 / 리나 = 0.75. */
export const MIN_SIMILARITY = 0.75;
const MAX_EDITS = 2;

// ---------- чамо ----------

/** Слог хангыля → чамо: начальная, гласная, конечная (если есть). Прочее — как есть. */
export function jamo(s: string): string[] {
  const out: string[] = [];
  for (const ch of s.replace(/\s+/g, "")) {
    const c = ch.charCodeAt(0) - 0xac00;
    if (c < 0 || c >= 11172) {
      out.push(ch);
      continue;
    }
    out.push(`L${Math.floor(c / 588)}`, `V${Math.floor((c % 588) / 28)}`);
    if (c % 28) out.push(`T${c % 28}`);
  }
  return out;
}

function editDistance(a: string[], b: string[]): number {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]!;
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = d[j]!;
      d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return d[b.length]!;
}

const syllables = (s: string) => [...s.replace(/[^가-힣]/g, "")].length;

/** Похожесть двух корейских написаний 0…1; 0 — если различаются больше чем на MAX_EDITS чамо или на 2+ слога. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.split(" ").length !== b.split(" ").length) return 0;
  if (Math.abs(syllables(a) - syllables(b)) > 1) return 0;
  const x = jamo(a);
  const y = jamo(b);
  const dist = editDistance(x, y);
  if (dist > MAX_EDITS) return 0;
  return 1 - dist / Math.max(x.length, y.length);
}

/** Транслитерация русского имени по словам: «Анна Петровна» → «안나 페트로프나», «Иссык-Куль» → «이시크쿨». */
export function translitName(ru: string): string {
  return ru
    .replace(/ё/gi, (m) => (m === "Ё" ? "Е" : "е"))
    .split(/\s+/)
    .map((w) => w.split("-").filter((p) => /^[А-Яа-яЁё]+$/.test(p)).map(hangulizeRu).join(""))
    .filter(Boolean)
    .join(" ");
}

// ---------- поиск вариантов ----------

/** Слово и оно же без частицы на конце (렌나는 → 렌나); основа — не короче двух слогов. */
function stripParticle(w: string): string[] {
  const out = [w];
  for (const p of KO_PARTICLES) if (w.endsWith(p) && syllables(w) - syllables(p) >= 2) out.push(w.slice(0, -p.length));
  return out;
}

/** Кандидаты из k слов подряд (слова в тексте разделены одним пробелом). */
function candidates(text: string, k: number): string[] {
  const out = new Set<string>();
  const re = /[가-힣]+(?: [가-힣]+)*/g;
  for (const run of text.match(re) ?? []) {
    const ws = run.split(" ");
    for (let i = 0; i + k <= ws.length; i++) {
      const head = ws.slice(i, i + k - 1);
      for (const last of stripParticle(ws[i + k - 1]!)) out.add([...head, last].join(" "));
    }
  }
  return [...out];
}

/** Сколько раз вариант стоит в тексте как имя (целое слово, после — ничего или частица). */
function countKo(text: string | null, ko: string): number {
  return replaceKo(text, ko, ko === "가가" ? "나나" : "가가").count;
}

const koTexts = (c: SpellingChapter) => [c.text_ko, c.title_ko, c.quote_ko];
const ruCount = (c: SpellingChapter, name: string) => countRu(c.text_ru, name) + countRu(c.title, name) + countRu(c.quote, name);

interface Anchor {
  e: SpellingEntity;
  known: string | null;
  anchors: string[];
  k: number;
}

/** План пакетной поправки для одной семьи. Ничего не пишет. */
export function planSpellings(entities: SpellingEntity[], chapters: SpellingChapter[]): SpellingPlan {
  const ordered = [...chapters].sort((a, b) => a.created_at.localeCompare(b.created_at));
  // правка семьи — первой (при совпадении имён она и выигрывает)
  const ranked = entities
    .filter((e) => e.kind === "person" || e.kind === "place")
    .sort((a, b) => Number(b.source === "family") - Number(a.source === "family"));

  const anchors: Anchor[] = [];
  for (const e of ranked) {
    const known = validKo(e.name_ko);
    const tr = translitName(e.name_ru);
    const list = [...new Set([known, tr].filter((x): x is string => !!x && syllables(x) >= 2))];
    if (!list.length) continue;
    anchors.push({ e, known, anchors: list, k: list[0]!.split(" ").length });
  }

  // 1) варианты: в главе с именем в русском; на каждого кандидата — одно, самое похожее имя
  const found = new Map<string, Map<string, { count: number; first: number; perChapter: Map<string, number> }>>();
  const common = new Set<string>(); // вариант встречается в главе без этого имени → обычное слово
  ordered.forEach((ch, idx) => {
    const ko = koTexts(ch).filter(Boolean).join("\n");
    if (!ko) return;
    const ks = new Set(anchors.map((a) => a.k));
    for (const k of ks) {
      for (const cand of candidates(ko, k)) {
        let best: Anchor | null = null;
        let bestSim = 0;
        let tie = false;
        for (const a of anchors) {
          if (a.k !== k) continue;
          const s = Math.max(...a.anchors.map((x) => similarity(cand, x)));
          if (s < MIN_SIMILARITY) continue;
          if (s > bestSim) {
            best = a;
            bestSim = s;
            tie = false;
          } else if (s === bestSim && best && best.e.id !== a.e.id) tie = true;
        }
        if (!best || tie) continue;
        const n = koTexts(ch).reduce((sum, t) => sum + countKo(t, cand), 0);
        if (!n) continue;
        if (ruCount(ch, best.e.name_ru) === 0) {
          common.add(`${best.e.id}\u0000${cand}`);
          continue;
        }
        const byKo = found.get(best.e.id) ?? new Map();
        const v = byKo.get(cand) ?? { count: 0, first: idx, perChapter: new Map<string, number>() };
        v.count += n;
        v.perChapter.set(ch.id, n);
        byKo.set(cand, v);
        found.set(best.e.id, byKo);
      }
    }
  });

  // 2) победитель и замены
  const patches = new Map<string, ChapterPatch>();
  const plans: EntityPlan[] = [];
  for (const a of anchors) {
    const byKo = found.get(a.e.id);
    if (!byKo) continue;
    for (const ko of [...byKo.keys()]) if (common.has(`${a.e.id}\u0000${ko}`) && ko !== a.known) byKo.delete(ko);
    if (!byKo.size) continue;
    const to =
      a.known ??
      [...byKo.entries()].sort((x, y) => y[1].count - x[1].count || x[1].first - y[1].first)[0]![0];
    const learn = !a.known;
    const variants = [...byKo.entries()]
      .filter(([ko]) => ko !== to && !to.includes(ko) && !ko.includes(to))
      .map(([ko, v]) => ({ ko, ...v }));
    let changed = 0;
    let skipped = 0;
    for (const ch of ordered) {
      const vs = variants.filter((v) => v.perChapter.has(ch.id));
      if (!vs.length) continue;
      const total = vs.reduce((n, v) => n + v.perChapter.get(ch.id)!, 0) + (byKo.get(to)?.perChapter.get(ch.id) ?? 0);
      if (total > ruCount(ch, a.e.name_ru) + 1) {
        skipped++;
        continue;
      }
      const p = patches.get(ch.id) ?? { id: ch.id, title_ko: ch.title_ko, quote_ko: ch.quote_ko, text_ko: ch.text_ko, replaced: 0 };
      let n = 0;
      for (const v of vs) {
        for (const f of ["title_ko", "quote_ko", "text_ko"] as const) {
          const r = replaceKo(p[f], v.ko, to);
          if (r.count) {
            p[f] = r.text;
            n += r.count;
          }
        }
      }
      if (n) {
        p.replaced += n;
        patches.set(ch.id, p);
        changed++;
      }
    }
    if (!learn && !changed && !skipped) continue;
    plans.push({ id: a.e.id, kind: a.e.kind, to, learn, variants: variants.map(({ ko, count }) => ({ ko, count })), chapters: changed, skipped });
  }
  return { entities: plans, chapters: [...patches.values()] };
}
