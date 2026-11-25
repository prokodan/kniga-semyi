// #201: чистая часть удаления тестовых семей киоска — какие семьи можно удалять и какие файлы Storage их.
// Без сети и без базы — проверяется тестами (scripts/delete-kiosk-families.test.ts).
// Правило: удаляем ТОЛЬКО семьи киоска (source = 'kiosk') и не демо (is_demo = false). Любой отказ —
// не удаляется ничего (всё или ничего), чтобы опечатка в id не превратилась в частичную чистку.
import { DEMO_FAMILY, DEMO_KIOSK_FAMILY } from "@/fixtures/demo/family";

export interface FamilyRow {
  id: string;
  source: "family" | "kiosk";
  is_demo: boolean;
  created_at: string;
}

/** Не короче 8 символов — как короткий id в diag и в issue. */
export const MIN_PREFIX = 8;

export interface Refusal {
  prefix: string;
  reason: string;
}

export interface Selection {
  families: FamilyRow[];
  refused: Refusal[];
}

const PROTECTED_IDS = new Set([DEMO_FAMILY.id, DEMO_KIOSK_FAMILY.id]);

export function parsePrefixes(input: string): string[] {
  return [
    ...new Set(
      input
        .split(/[\s,]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

export function selectFamilies(prefixes: string[], all: FamilyRow[]): Selection {
  const families: FamilyRow[] = [];
  const refused: Refusal[] = [];
  if (prefixes.length === 0) refused.push({ prefix: "—", reason: "не указано ни одной семьи" });
  for (const prefix of prefixes) {
    if (prefix === "all" || prefix.length < MIN_PREFIX || !/^[0-9a-f-]+$/.test(prefix)) {
      refused.push({ prefix, reason: `нужен id семьи (не короче ${MIN_PREFIX} символов, только 0-9 a-f), «all» не принимается` });
      continue;
    }
    const found = all.filter((f) => f.id.toLowerCase().startsWith(prefix));
    if (found.length === 0) {
      refused.push({ prefix, reason: "семья не найдена (уже удалена?)" });
      continue;
    }
    if (found.length > 1) {
      refused.push({ prefix, reason: `совпадает с ${found.length} семьями — укажите id длиннее` });
      continue;
    }
    const f = found[0]!;
    if (f.is_demo || PROTECTED_IDS.has(f.id)) refused.push({ prefix, reason: "демо-семья (is_demo) — удалять нельзя" });
    else if (f.source !== "kiosk") refused.push({ prefix, reason: `семья пришла сама (source=${f.source}) — этим скриптом не удаляется` });
    else if (!families.some((x) => x.id === f.id)) families.push(f);
  }
  return { families, refused };
}

/**
 * Файлы семьи в Storage: всё лежит под «<familyId>/» в каждом бакете (audio, photos, books, illustrations).
 * Пути из строк (audio_url, photo_url, pdf_url…) вне этой папки (например, общие голоса демо «_demo/…»)
 * НЕ удаляются — только показываются.
 */
export function ownPaths(familyId: string, paths: (string | null | undefined)[]): { own: string[]; foreign: string[] } {
  const own = new Set<string>();
  const foreign = new Set<string>();
  for (const p of paths) {
    if (!p) continue;
    const clean = p.replace(/^\/+/, "");
    if (clean.startsWith(`${familyId}/`) && !clean.includes("..")) own.add(clean);
    else foreign.add(clean);
  }
  return { own: [...own].sort(), foreign: [...foreign].sort() };
}
