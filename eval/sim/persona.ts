// Загрузка вымышленного рассказчика из eval/personas/<key>.md (формат — eval/personas/kim.md).
// Раздел «Ключевые факты» — эталон для сверки; персонажу (persona_reply) его не отдаём,
// чтобы он рассказывал биографию, а не зачитывал список ответов.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { BookLang } from "@/lib/types";

/** Профили поведения из eval/behaviors.md. */
export const BEHAVIORS = ["one-word", "wanders", "confuses-dates", "koryo-mar", "refuses", "long", "emotional"] as const;
export type Behavior = (typeof BEHAVIORS)[number];

export interface Persona {
  key: string;
  /** Первая строка-заголовок без ключа: «Ким Николай Петрович» */
  name: string;
  /** Markdown для persona_reply — без раздела «Ключевые факты» */
  markdown: string;
  defaultBehaviors: string[];
  /** Строки раздела «Ключевые факты (эталон для проверки)» */
  keyFacts: string[];
  /**
   * #231: языки книги из строки «книга: `kk,ru`» (несколько вариантов — «`ru` или `ru,kk`» — берём с большим числом
   * языков, чтобы прогон проверял перевод). Нет строки — undefined: книга как сейчас (ru, ko).
   */
  bookLangs?: BookLang[];
  /**
   * #282: культурные пакеты банка вопросов из строки «пакеты: `general` + `kz`» (как у семьи с флагом culture_packs).
   * Нет строки — undefined: банк V0, как сейчас (kim, pak, tsoi не меняются).
   */
  packs?: string[];
}

/** «пакеты: `general` + `kz`» → ["general", "kz"]; в скобках — планы («(позже + `ua`)»), их не берём. */
export function parsePacks(md: string): string[] | undefined {
  const line = md.match(/пакеты:\s*([^·\n]+)/i)?.[1] ?? "";
  const packs = [...line.replace(/\([^)]*\)/g, "").matchAll(/`([a-z0-9_-]+)`/g)].map((m) => m[1]!);
  return packs.length ? [...new Set(packs)] : undefined;
}

/** «книга: `ru` или `ru,kk`» → ["ru", "kk"]; неизвестные языки отбрасываются. */
export function parseBookLangs(md: string): BookLang[] | undefined {
  const line = md.match(/книга:\s*([^·\n]+)/i)?.[1] ?? "";
  const variants = [...line.matchAll(/`([^`]+)`/g)]
    .map((m) => m[1]!.split(",").map((l) => l.trim()).filter((l): l is BookLang => (["ru", "ko", "kk"] as string[]).includes(l)))
    .filter((v) => v.length > 0);
  if (!variants.length) return undefined;
  return variants.reduce((a, b) => (b.length > a.length ? b : a));
}

export const PERSONAS_DIR = path.join(process.cwd(), "eval", "personas");

export function listPersonas(dir = PERSONAS_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""))
    .sort();
}

/** Разделы второго уровня: «## Заголовок» → тело до следующего «## ». */
function sections(md: string): { title: string; start: number; end: number }[] {
  const re = /^## (.+)$/gm;
  const found: { title: string; start: number }[] = [];
  for (let m = re.exec(md); m; m = re.exec(md)) found.push({ title: m[1]!.trim(), start: m.index });
  return found.map((s, i) => ({ ...s, end: found[i + 1]?.start ?? md.length }));
}

export function parsePersona(key: string, md: string): Persona {
  const header = md.match(/^# (.+)$/m)?.[1]?.trim() ?? key;
  const name = header.replace(/\s*\([^)]*\)\s*$/, "").trim();

  const profilesLine = md.match(/Профили по умолчанию:\s*(.+)$/m)?.[1] ?? "";
  const defaultBehaviors = [...profilesLine.matchAll(/`([^`]+)`/g)].map((m) => m[1]!.trim());

  const factsSection = sections(md).find((s) => /^Ключевые факты/i.test(s.title));
  const keyFacts = factsSection
    ? md
        .slice(factsSection.start, factsSection.end)
        .split("\n")
        .filter((l) => /^\s*[-*]\s+/.test(l))
        .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
        .filter(Boolean)
    : [];
  const markdown = factsSection ? (md.slice(0, factsSection.start) + md.slice(factsSection.end)).trim() : md.trim();

  const bookLangs = parseBookLangs(md);
  const packs = parsePacks(md);
  return { key, name, markdown, defaultBehaviors, keyFacts, ...(bookLangs ? { bookLangs } : {}), ...(packs ? { packs } : {}) };
}

export function loadPersona(key: string, dir = PERSONAS_DIR): Persona {
  if (!/^[a-z0-9-]+$/.test(key)) throw new Error(`Неверный ключ персонажа: ${key}`);
  const known = listPersonas(dir);
  if (!known.includes(key)) throw new Error(`Нет персонажа «${key}». Есть: ${known.join(", ")}`);
  return parsePersona(key, readFileSync(path.join(dir, `${key}.md`), "utf8"));
}

/** Строка behavior для persona_reply: явный профиль или профили персонажа по умолчанию. */
export function resolveBehavior(persona: Persona, override?: string): string | undefined {
  if (override) {
    if (!(BEHAVIORS as readonly string[]).includes(override)) {
      throw new Error(`Неизвестный профиль «${override}». Есть: ${BEHAVIORS.join(", ")}`);
    }
    return override;
  }
  return persona.defaultBehaviors.length > 0 ? persona.defaultBehaviors.join(", ") : undefined;
}
