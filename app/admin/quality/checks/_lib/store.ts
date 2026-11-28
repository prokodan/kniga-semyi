import "server-only";
// #353: точки входа «Проверок» и /review 2.0 для страниц и API. Токен — только в ответе на создание и в адресе
// ссылки; в базе — sha256 (как #232), в логах — только id ссылки.
import { getDbOrNull } from "@/lib/db";
import type { ReviewPair } from "@/lib/types";
import { TOKEN_RE, hashReviewToken, linkStatus, newReviewToken, pairLangs, reviewerLabel } from "@/app/admin/reviews/_lib/core";
import { CRITERIA, nuanceTags, type CheckKind, type FocusTerm, type UiLang } from "./core";
import { focusFor, pickItems, setMaterials, type Material } from "./materials";
import { MemoryCheckStore, SupabaseCheckStore, type CheckBundle, type CheckLink, type CheckStore } from "./repo";

type G = { __checkMemory?: MemoryCheckStore };

export function checkStore(): { store: CheckStore; memory: boolean } {
  const db = getDbOrNull();
  if (db) return { store: new SupabaseCheckStore(db), memory: false };
  const g = globalThis as G;
  g.__checkMemory ??= new MemoryCheckStore();
  return { store: g.__checkMemory, memory: true };
}

export class CheckLinkError extends Error {}

// ---------------- материал: банк Q1 (quality_items), пока его нет — наборы репозитория ----------------

type QualityRow = {
  id: string;
  run_id: string | null;
  position: number;
  title: string | null;
  src_text: string;
  out_text: string;
  lang_from: string;
  lang_to: string;
  focus_terms: unknown;
};

function asFocus(v: unknown, text: string, to: string): FocusTerm[] {
  if (Array.isArray(v)) {
    const out = v
      .map((x): FocusTerm | null => (typeof x === "string" ? { term: x } : x && typeof x === "object" && typeof (x as FocusTerm).term === "string" ? { term: (x as FocusTerm).term, hint: (x as FocusTerm).hint } : null))
      .filter((x): x is FocusTerm => Boolean(x?.term && text.includes(x.term)));
    if (out.length) return out.slice(0, 8);
  }
  return focusFor(text, to);
}

/**
 * Материал из банка Q1 (#352, миграция 20261128190000: quality_items ← quality_runs ← quality_texts / quality_personas).
 * Только шаг translate, самый свежий прогон каждой личности / текста. focus_terms банка — слова ОРИГИНАЛА ({src}),
 * поэтому фокус-слова перевода ищем сами. Таблицы нет / пусто → null, и форма берёт наборы репозитория.
 */
async function qualityMaterials(pair: ReviewPair): Promise<Material[] | null> {
  const db = getDbOrNull();
  if (!db) return null;
  const { from, to } = pairLangs(pair);
  const { data, error } = await db
    .from("quality_items")
    .select("id, run_id, position, title, src_text, out_text, lang_from, lang_to, focus_terms")
    .eq("lang_from", from)
    .eq("lang_to", to)
    .eq("step", "translate")
    .order("created_at", { ascending: false })
    .limit(400);
  if (error || !data?.length) return null;
  const rows = data as QualityRow[];
  // теги и имя личности — по возможности (если схема Q1 другая — без них)
  const runs = new Map<string, { kind: string; ref_id: string; commit_sha?: string }>();
  const texts = new Map<string, { event?: string; nuance_tags?: string[]; persona_id?: string }>();
  const personas = new Map<string, string>();
  try {
    const runIds = [...new Set(rows.map((r) => r.run_id).filter((x): x is string => Boolean(x)))];
    if (runIds.length) {
      const { data: rr } = await db.from("quality_runs").select("id, kind, ref_id, commit_sha").in("id", runIds);
      for (const r of (rr ?? []) as { id: string; kind: string; ref_id: string; commit_sha?: string }[]) runs.set(r.id, r);
      const textIds = [...runs.values()].filter((r) => r.kind === "text").map((r) => r.ref_id);
      if (textIds.length) {
        const { data: tt } = await db.from("quality_texts").select("id, event, nuance_tags, persona_id").in("id", textIds);
        for (const t of (tt ?? []) as { id: string; event?: string; nuance_tags?: string[]; persona_id?: string }[]) texts.set(t.id, t);
      }
      const personaIds = [
        ...new Set([...runs.values()].filter((r) => r.kind === "persona").map((r) => r.ref_id).concat([...texts.values()].map((t) => t.persona_id ?? "").filter(Boolean))),
      ];
      if (personaIds.length) {
        const { data: pp } = await db.from("quality_personas").select("id, name").in("id", personaIds);
        for (const p of (pp ?? []) as { id: string; name: string }[]) personas.set(p.id, p.name);
      }
    }
  } catch {
    /* без тегов */
  }
  // один и тот же текст / личность прогоняли несколько раз — берём свежий прогон (строки уже новые сверху)
  const seen = new Set<string>();
  const fresh = rows.filter((r) => {
    const run = r.run_id ? runs.get(r.run_id) : undefined;
    const k = run ? `${run.kind}:${run.ref_id}:${r.position}` : r.id;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return fresh.map((r): Material => {
    const run = r.run_id ? runs.get(r.run_id) : undefined;
    const text = run?.kind === "text" ? texts.get(run.ref_id) : undefined;
    const persona = personas.get(run?.kind === "persona" ? run.ref_id : (text?.persona_id ?? "")) ?? "банк";
    const focus = asFocus(r.focus_terms, r.out_text, to);
    const tags = text?.nuance_tags?.length ? text.nuance_tags : nuanceTags(r.src_text);
    return {
      id: `quality:${r.id}`,
      pair,
      origin: "quality",
      originLabel: run?.kind === "persona" ? "банк · прогон личности" : "банк · текст",
      title: r.title || text?.event || null,
      persona,
      tags: [...tags, `персонаж: ${persona}`],
      focusTerms: focus,
      words: r.src_text.split(/\s+/).filter(Boolean).length,
      seed: {
        kind: "chapter",
        source_lang: from,
        target_lang: to,
        title: r.title || text?.event || null,
        source_text: r.src_text,
        model_text: r.out_text,
        prompt_version: run?.commit_sha ? `quality ${run.commit_sha.slice(0, 7)}` : "quality",
        persona: `quality:${persona}`,
        focus_terms: focus.length ? focus : null,
        item_ref: r.id,
      },
    };
  });
}

export async function loadMaterials(pair: ReviewPair): Promise<{ materials: Material[]; source: "quality" | "sets" }> {
  const q = await qualityMaterials(pair).catch(() => null);
  if (q?.length) return { materials: q, source: "quality" };
  return { materials: setMaterials(pair), source: "sets" };
}

// ---------------- ссылки ----------------

export async function createCheckLink(input: {
  pair: ReviewPair;
  kind: CheckKind;
  uiLang: UiLang;
  reviewer: string;
  days: number;
  ids: string[];
}): Promise<{ token: string; link: CheckLink; items: number }> {
  const { materials, source } = await loadMaterials(input.pair);
  const items = pickItems(materials, input.ids, input.kind);
  if (!items.length) {
    throw new CheckLinkError(input.kind === "terms" ? "Отметьте хотя бы один текст, где есть 3 и больше выделенных слов." : "Отметьте хотя бы один текст.");
  }
  const label = reviewerLabel(input.reviewer);
  if (!label) throw new CheckLinkError("Укажите имя проверяющего — сохраним только инициалы.");
  const days = Math.min(90, Math.max(1, Math.round(input.days || 14)));
  const token = newReviewToken();
  const link = await checkStore().store.createLink(
    {
      token_hash: hashReviewToken(token),
      pair: input.pair,
      kind: input.kind,
      criteria: [...CRITERIA],
      ui_lang: input.uiLang,
      reviewer_label: label,
      items_set: `pick:${source}:${items.length}`,
      expires_at: new Date(Date.now() + days * 86_400_000).toISOString(),
    },
    items,
  );
  return { token, link, items: items.length };
}

export type OpenCheck =
  | { status: "missing" }
  /** старая ссылка #232 (kind = null) или миграция #353 ещё не прошла — страница показывает её как раньше */
  | { status: "legacy" }
  | { status: "expired" | "revoked"; link: CheckLink }
  | { status: "active"; link: CheckLink; bundle: CheckBundle };

export async function openCheck(token: string): Promise<OpenCheck> {
  if (!TOKEN_RE.test(token)) return { status: "missing" };
  const { store, memory } = checkStore();
  let link: CheckLink | null;
  try {
    link = await store.findByHash(hashReviewToken(token));
  } catch {
    return { status: "legacy" }; // нет столбцов kind / criteria — старая схема
  }
  if (!link) return { status: memory ? "legacy" : "missing" };
  if (!link.kind) return { status: "legacy" };
  const status = linkStatus(link);
  if (status !== "active") return { status, link };
  return { status, link, bundle: await store.bundle(link) };
}
