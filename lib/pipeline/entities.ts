// #102: словарь семьи (таблица family_entities, контракт — #104). После каждой собранной главы в него попадают
// люди и места из facts главы и слова корё мар из её текста; для следующих глав словарь — подсказка
// расшифровке (hints, первыми), редактуре (entities: кто есть кто) и переводу (names: как писать по-корейски).
// Записи source='family' (правка семьи, #104) автоматика не меняет — только дописывает главу в story_ids.
// Чистые функции: разбор главы и слияние со словарём; запись в базу — repo.saveEntities.
import { GLOSSARY_KORYO } from "@/lib/interview/names";
import type { FamilyEntity, FamilyEntityKind, StoryFact } from "@/lib/types";

export interface EntityDraft {
  kind: FamilyEntityKind;
  name_ru: string;
  description: string | null;
}

const yo = (s: string) => s.toLowerCase().replace(/ё/g, "е").trim();
export const entityKey = yo;

/** Слова корё мар, которые легко спутать с русскими или слишком короткие — в словарь семьи сами не попадают. */
const KORYO_SKIP = new Set(["пап", "хе", "чеса", "морковча", "корё мар", "корё-сарам"]);

function clean(v: string): string {
  return v.replace(/[«»"“”()]/g, "").replace(/\s+/g, " ").trim();
}

/** «Олег и Лена», «Олег, Лена» → два имени; длинные описания и значения с цифрами — не имена. */
function splitNames(v: string): string[] {
  return clean(v)
    .split(/\s*(?:,|;|\sи\s)\s*/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2 && p.length <= 40 && !/\d/.test(p) && p.split(" ").length <= 4);
}

/**
 * #235: люди одного факта главы («Олег и Лена» → два имени) — тот же разбор, что у словаря, чтобы древо и словарь
 * понимали факт одинаково. Не person — пусто.
 */
export function factPeople(f: Pick<StoryFact, "type" | "value">): string[] {
  return f.type === "person" ? splitNames(f.value ?? "") : [];
}

/** Сущности одной главы: люди и места из facts, слова корё мар из текста. */
export function entitiesFromChapter(ch: { text_ru: string | null; facts: Pick<StoryFact, "type" | "value" | "relation">[] }): EntityDraft[] {
  const out: EntityDraft[] = [];
  const seen = new Set<string>();
  const add = (d: EntityDraft) => {
    const k = yo(d.name_ru);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(d);
  };
  for (const f of ch.facts ?? []) {
    if (f.type !== "person" && f.type !== "place") continue;
    const names = splitNames(f.value ?? "");
    for (const n of names) {
      add({ kind: f.type, name_ru: n, description: f.type === "person" && f.relation && names.length === 1 ? clean(f.relation).slice(0, 120) : null });
    }
  }
  const text = yo(ch.text_ru ?? "");
  for (const w of GLOSSARY_KORYO) {
    if (KORYO_SKIP.has(w) || w.length < 4) continue;
    // основа + окончание: «кочжана», «пигоди», «чимчи»
    const re = new RegExp(`(^|[^а-яе])${yo(w).replace(/[-]/g, "\\-")}[а-я]{0,3}(?![а-я])`, "u");
    if (re.test(text)) add({ kind: "word", name_ru: w, description: null });
  }
  return out;
}

/** Та же запись словаря: совпадение без регистра и ё или то же имя в другом падеже («Лены» ↔ «Лена»). */
export function sameEntity(a: string, b: string): boolean {
  const x = yo(a);
  const y = yo(b);
  if (x === y) return true;
  if (x.includes(" ") || y.includes(" ")) return false;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  if (s.length < 4 || l.length - s.length > 2) return false;
  let p = 0;
  while (p < s.length && s[p] === l[p]) p++;
  return p >= s.length - 1 && p >= l.length - 2;
}

export interface EntityChanges {
  inserts: Omit<FamilyEntity, "id" | "updated_at">[];
  updates: { id: string; patch: Partial<Pick<FamilyEntity, "story_ids" | "description" | "kind">> }[];
}

/** Слить сущности главы со словарём семьи. */
export function mergeEntities(existing: Pick<FamilyEntity, "id" | "kind" | "name_ru" | "description" | "story_ids" | "source">[], drafts: EntityDraft[], familyId: string, storyId: string): EntityChanges {
  const inserts: EntityChanges["inserts"] = [];
  const updates = new Map<string, EntityChanges["updates"][number]["patch"]>();
  for (const d of drafts) {
    const hit = existing.find((e) => sameEntity(e.name_ru, d.name_ru)) ?? null;
    if (!hit) {
      if (inserts.some((i) => sameEntity(i.name_ru, d.name_ru))) continue;
      inserts.push({ family_id: familyId, kind: d.kind, name_ru: d.name_ru, name_ko: null, description: d.description, story_ids: [storyId], source: "auto" });
      continue;
    }
    const patch = updates.get(hit.id) ?? {};
    if (!(hit.story_ids ?? []).includes(storyId)) patch.story_ids = [...(hit.story_ids ?? []), storyId];
    if (hit.source === "auto" && !hit.description && d.description) patch.description = d.description;
    if (Object.keys(patch).length) updates.set(hit.id, patch);
  }
  return { inserts, updates: [...updates].map(([id, patch]) => ({ id, patch })) };
}

/** Порядок подсказок: правка семьи → чаще встречается → свежее. Имена — первыми в hints расшифровки. */
export function rankEntities<T extends Pick<FamilyEntity, "source" | "story_ids" | "updated_at">>(list: T[]): T[] {
  return [...list].sort(
    (a, b) =>
      Number(b.source === "family") - Number(a.source === "family") ||
      (b.story_ids?.length ?? 0) - (a.story_ids?.length ?? 0) ||
      (b.updated_at ?? "").localeCompare(a.updated_at ?? ""),
  );
}

/** Для редактуры: кто есть кто (до 60, коротко). */
export function entitiesForEdit(list: Pick<FamilyEntity, "kind" | "name_ru" | "description" | "source" | "story_ids" | "updated_at">[]) {
  return rankEntities(list)
    .slice(0, 60)
    .map((e) => ({ kind: e.kind, name: e.name_ru, ...(e.description ? { about: e.description.slice(0, 80) } : {}) }));
}

/** Для перевода: как писать по-корейски (только где написание известно). */
export function namesForTranslate(list: Pick<FamilyEntity, "name_ru" | "name_ko" | "source" | "story_ids" | "updated_at">[]) {
  return rankEntities(list)
    .filter((e) => e.name_ko?.trim())
    .slice(0, 60)
    .map((e) => ({ ru: e.name_ru, ko: e.name_ko!.trim() }));
}
