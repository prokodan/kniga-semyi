// #352: сид банка проверок и версия промптов прогона. Читает файлы репозитория (fs) — только скрипты и тесты,
// не страницы: eval/quality/seed.<пара>.json (личности и тексты, черновик — Claude продукта) и eval/personas/*.md
// (существующие eval-персонажи → source=seed).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { listPersonas, parsePersona } from "@/eval/sim/persona";
import { cleanFocus, cleanTags, seedUuid } from "./core";
import type { NewPersona, NewText } from "./repo";
import { isQualityPair, PAIR_PACK, type QualityPair } from "./types";

export interface SeedPersona {
  key: string;
  /** eval-персонаж (eval/personas/<eval>.md) — имя, биография и манера речи оттуда */
  eval?: string;
  name?: string;
  pack?: string;
  bio?: string;
  speech_style?: string;
  tags?: string[];
}

export interface SeedText {
  key: string;
  persona: string;
  event: string;
  nuance_tags: string[];
  focus_terms: string[];
  text: string;
}

export interface SeedFile {
  pair: QualityPair;
  personas: SeedPersona[];
  texts: SeedText[];
}

export const SEED_DIR = path.join(process.cwd(), "eval", "quality");

export function loadSeedFiles(dir = SEED_DIR): SeedFile[] {
  return readdirSync(dir)
    .filter((f) => /^seed\.[a-z]{2}-[a-z]{2}\.json$/.test(f))
    .sort()
    .map((f) => {
      const s = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as SeedFile;
      if (!isQualityPair(s.pair)) throw new Error(`${f}: неизвестная пара ${String(s.pair)}`);
      return s;
    });
}

/** Раздел «## Манера речи» markdown персонажа — для карточки в админке. */
function mannerOf(md: string): string {
  const part = md.split(/^## /m).find((s) => s.startsWith("Манера речи"));
  return part ? part.replace(/^Манера речи\s*/, "").trim() : "";
}

/** Строки сида для базы: детерминированные id и seed_key — повторный сид ничего не дублирует. */
export function seedRows(files: SeedFile[], personasDir?: string): { personas: NewPersona[]; texts: NewText[] } {
  const evalKeys = new Set(listPersonas(personasDir));
  const personas: NewPersona[] = [];
  const texts: NewText[] = [];
  for (const f of files) {
    const ids = new Map<string, string>();
    for (const p of f.personas) {
      const seed_key = p.eval ? `eval:${p.eval}:${f.pair}` : `seed:${f.pair}:${p.key}`;
      const id = seedUuid(seed_key);
      ids.set(p.key, id);
      if (p.eval) {
        if (!evalKeys.has(p.eval)) throw new Error(`${f.pair}: нет eval-персонажа ${p.eval}`);
        const md = readFileSync(path.join(personasDir ?? path.join(process.cwd(), "eval", "personas"), `${p.eval}.md`), "utf8");
        const parsed = parsePersona(p.eval, md);
        personas.push({
          id,
          seed_key,
          pair: f.pair,
          pack: p.pack ?? (parsed.packs?.filter((x) => x !== "general").join("+") || PAIR_PACK[f.pair]),
          name: parsed.name,
          // markdown персонажа без «Ключевых фактов» — как его видит persona_reply в eval
          bio: parsed.markdown,
          speech_style: mannerOf(parsed.markdown),
          tags: cleanTags(p.tags ?? []),
          source: "seed",
          status: "active",
        });
        continue;
      }
      if (!p.name || !p.bio || !p.speech_style) throw new Error(`${f.pair}: у личности ${p.key} нет имени, биографии или манеры речи`);
      personas.push({
        id,
        seed_key,
        pair: f.pair,
        pack: p.pack ?? PAIR_PACK[f.pair],
        name: p.name,
        bio: p.bio,
        speech_style: p.speech_style,
        tags: cleanTags(p.tags ?? []),
        source: "seed",
        status: "active",
      });
    }
    for (const t of f.texts) {
      const persona_id = ids.get(t.persona);
      if (!persona_id) throw new Error(`${f.pair}: текст ${t.key} — нет личности ${t.persona}`);
      texts.push({
        id: seedUuid(`seed:${f.pair}:text:${t.key}`),
        seed_key: `seed:${f.pair}:text:${t.key}`,
        pair: f.pair,
        persona_id,
        event: t.event,
        text_src: t.text,
        nuance_tags: cleanTags(t.nuance_tags),
        focus_terms: cleanFocus(t.focus_terms, t.text),
        source: "seed",
        status: "active",
      });
    }
  }
  return { personas, texts };
}

/** Версия промптов прогона: sha256 (12 символов) каждого файла prompts/* — к чему относится оценка. */
export function promptVersions(root = process.cwd()): Record<string, string> {
  const dir = path.join(root, "prompts");
  const out: Record<string, string> = {};
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith(".md")) continue;
    out[f] = createHash("sha256").update(readFileSync(path.join(dir, f), "utf8")).digest("hex").slice(0, 12);
  }
  return out;
}
