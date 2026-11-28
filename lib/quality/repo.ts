// #352: хранилище банка проверок — Supabase (service-ключ) или память (локально без базы, тесты).
// Без server-only: тот же код читает scripts/quality-run.ts. Клиент Supabase передаётся снаружи.
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { avgRating } from "./core";
import {
  EMPTY_COUNTERS,
  type CardCounters,
  type QualityItem,
  type QualityKind,
  type QualityPair,
  type QualityPersona,
  type QualityRun,
  type QualityStatus,
  type QualityText,
} from "./types";

export type NewPersona = Omit<QualityPersona, "id" | "created_at" | "seed_key" | "status"> & { id?: string; seed_key?: string | null; status?: QualityStatus };
export type NewText = Omit<QualityText, "id" | "created_at" | "seed_key" | "status"> & { id?: string; seed_key?: string | null; status?: QualityStatus };
export type NewRun = Omit<QualityRun, "id" | "created_at">;
export type NewItem = Omit<QualityItem, "id" | "run_id">;

export interface QualityRepo {
  personas(pair?: QualityPair): Promise<QualityPersona[]>;
  texts(pair?: QualityPair): Promise<QualityText[]>;
  addPersona(p: NewPersona): Promise<QualityPersona>;
  addText(t: NewText): Promise<QualityText>;
  setStatus(kind: QualityKind, ids: string[], status: QualityStatus, onlyFrom?: QualityStatus): Promise<void>;
  /** Сид: строки с seed_key, которых ещё нет (существующие — не трогаем, в том числе статус «архив»). */
  upsertSeed(personas: NewPersona[], texts: NewText[]): Promise<{ personas: number; texts: number }>;
  addRun(run: NewRun, items: NewItem[]): Promise<QualityRun>;
  /** Последние прогоны пары, новые сверху */
  runs(pair: QualityPair, limit?: number): Promise<QualityRun[]>;
  /** Счётчики карточек пары: id личности / текста → прогонов, ссылок, проверено, средняя оценка */
  counters(pair: QualityPair): Promise<Map<string, CardCounters>>;
  /** Сколько $ ушло на прогоны с момента since (лимит на сутки) */
  runSpendSince(since: Date): Promise<number>;
}

const P_COLS = "id, pair, pack, name, bio, speech_style, tags, status, source, seed_key, created_at";
const T_COLS = "id, pair, persona_id, event, text_src, nuance_tags, focus_terms, status, source, seed_key, created_at";
const R_COLS = "id, kind, ref_id, pair, commit_sha, prompt_versions, models, env, status, calls, cost_usd, error, batch, created_at";

const chunks = <T>(xs: T[], n = 100): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

function normText(r: QualityText): QualityText {
  return { ...r, focus_terms: Array.isArray(r.focus_terms) ? r.focus_terms : [] };
}
function normRun(r: QualityRun): QualityRun {
  return { ...r, cost_usd: Number(r.cost_usd ?? 0) };
}

export class SupabaseQualityRepo implements QualityRepo {
  constructor(private readonly db: SupabaseClient) {}

  async personas(pair?: QualityPair): Promise<QualityPersona[]> {
    let q = this.db.from("quality_personas").select(P_COLS).order("created_at");
    if (pair) q = q.eq("pair", pair);
    const { data, error } = await q.limit(500);
    if (error) throw new Error(`quality_personas: ${error.message}`);
    return (data ?? []) as QualityPersona[];
  }

  async texts(pair?: QualityPair): Promise<QualityText[]> {
    let q = this.db.from("quality_texts").select(T_COLS).order("created_at");
    if (pair) q = q.eq("pair", pair);
    const { data, error } = await q.limit(1000);
    if (error) throw new Error(`quality_texts: ${error.message}`);
    return ((data ?? []) as QualityText[]).map(normText);
  }

  async addPersona(p: NewPersona): Promise<QualityPersona> {
    const { data, error } = await this.db.from("quality_personas").insert(p).select(P_COLS).single();
    if (error) throw new Error(`quality_personas: ${error.message}`);
    return data as QualityPersona;
  }

  async addText(t: NewText): Promise<QualityText> {
    const { data, error } = await this.db.from("quality_texts").insert(t).select(T_COLS).single();
    if (error) throw new Error(`quality_texts: ${error.message}`);
    return normText(data as QualityText);
  }

  async setStatus(kind: QualityKind, ids: string[], status: QualityStatus, onlyFrom?: QualityStatus): Promise<void> {
    if (!ids.length) return;
    const table = kind === "persona" ? "quality_personas" : "quality_texts";
    for (const part of chunks(ids)) {
      let q = this.db.from(table).update({ status }).in("id", part);
      if (onlyFrom) q = q.eq("status", onlyFrom);
      const { error } = await q;
      if (error) throw new Error(`${table}: ${error.message}`);
    }
  }

  async upsertSeed(personas: NewPersona[], texts: NewText[]): Promise<{ personas: number; texts: number }> {
    const ins = async (table: string, rows: { seed_key?: string | null }[]) => {
      if (!rows.length) return 0;
      const { data, error } = await this.db.from(table).upsert(rows, { onConflict: "seed_key", ignoreDuplicates: true }).select("id");
      if (error) throw new Error(`${table}: ${error.message}`);
      return (data ?? []).length;
    };
    // личности первыми: тексты ссылаются на них (persona_id)
    const p = await ins("quality_personas", personas);
    const t = await ins("quality_texts", texts);
    return { personas: p, texts: t };
  }

  async addRun(run: NewRun, items: NewItem[]): Promise<QualityRun> {
    const { data, error } = await this.db.from("quality_runs").insert(run).select(R_COLS).single();
    if (error) throw new Error(`quality_runs: ${error.message}`);
    const created = normRun(data as QualityRun);
    if (items.length) {
      const { error: e2 } = await this.db.from("quality_items").insert(items.map((i) => ({ ...i, run_id: created.id })));
      if (e2) throw new Error(`quality_items: ${e2.message}`);
    }
    return created;
  }

  async runs(pair: QualityPair, limit = 20): Promise<QualityRun[]> {
    const { data, error } = await this.db.from("quality_runs").select(R_COLS).eq("pair", pair).order("created_at", { ascending: false }).limit(limit);
    if (error) throw new Error(`quality_runs: ${error.message}`);
    return ((data ?? []) as QualityRun[]).map(normRun);
  }

  async counters(pair: QualityPair): Promise<Map<string, CardCounters>> {
    const out = new Map<string, CardCounters>();
    const get = (id: string) => {
      let c = out.get(id);
      if (!c) out.set(id, (c = { ...EMPTY_COUNTERS }));
      return c;
    };
    const { data: runs, error } = await this.db.from("quality_runs").select("id, ref_id, status, created_at").eq("pair", pair).limit(5000);
    if (error) throw new Error(`quality_runs: ${error.message}`);
    const runRef = new Map<string, string>();
    for (const r of (runs ?? []) as { id: string; ref_id: string; status: string; created_at: string }[]) {
      runRef.set(r.id, r.ref_id);
      const c = get(r.ref_id);
      if (r.status !== "error") c.runs += 1;
      if (!c.lastRunAt || r.created_at > c.lastRunAt) c.lastRunAt = r.created_at;
    }
    if (!runRef.size) return out;

    // quality_items → review_items (item_ref — колонка Q2 #353) → review_feedback. Нет колонки / таблиц — только прогоны.
    const itemRef = new Map<string, string>();
    for (const part of chunks([...runRef.keys()])) {
      const { data } = await this.db.from("quality_items").select("id, run_id").in("run_id", part);
      for (const i of (data ?? []) as { id: string; run_id: string }[]) itemRef.set(i.id, runRef.get(i.run_id)!);
    }
    if (!itemRef.size) return out;
    const reviewRef = new Map<string, { ref: string; link: string }>();
    for (const part of chunks([...itemRef.keys()])) {
      const { data, error: e2 } = await this.db.from("review_items").select("id, link_id, item_ref").in("item_ref", part);
      if (e2) return out; // до миграции Q2 — колонки item_ref нет
      for (const r of (data ?? []) as { id: string; link_id: string; item_ref: string }[]) reviewRef.set(r.id, { ref: itemRef.get(r.item_ref)!, link: r.link_id });
    }
    const links = new Map<string, Set<string>>();
    for (const { ref, link } of reviewRef.values()) (links.get(ref) ?? links.set(ref, new Set()).get(ref)!).add(link);
    for (const [ref, set] of links) get(ref).links = set.size;

    const fbByRef = new Map<string, { ratings?: unknown; criteria?: unknown; skipped?: boolean | null; item_id: string }[]>();
    for (const part of chunks([...reviewRef.keys()])) {
      const { data, error: e3 } = await this.db.from("review_feedback").select("*").in("item_id", part);
      if (e3) return out;
      for (const f of (data ?? []) as { item_id: string; ratings?: unknown; criteria?: unknown; skipped?: boolean | null }[]) {
        const ref = reviewRef.get(f.item_id)?.ref;
        if (ref) (fbByRef.get(ref) ?? fbByRef.set(ref, []).get(ref)!).push(f);
      }
    }
    for (const [ref, rows] of fbByRef) {
      const c = get(ref);
      c.reviewed = new Set(rows.filter((r) => !r.skipped).map((r) => r.item_id)).size;
      c.avg = avgRating(rows);
    }
    return out;
  }

  async runSpendSince(since: Date): Promise<number> {
    const { data, error } = await this.db.from("quality_runs").select("cost_usd").gte("created_at", since.toISOString()).limit(5000);
    if (error) throw new Error(`quality_runs: ${error.message}`);
    return (data ?? []).reduce((s, r) => s + Number((r as { cost_usd: unknown }).cost_usd ?? 0), 0);
  }
}

/** Память процесса: локально без Supabase и в тестах (ссылок и отзывов нет — только прогоны). */
export class MemoryQualityRepo implements QualityRepo {
  readonly personaRows: QualityPersona[] = [];
  readonly textRows: QualityText[] = [];
  readonly runRows: QualityRun[] = [];
  readonly itemRows: QualityItem[] = [];
  constructor(private readonly now: () => Date = () => new Date()) {}

  async personas(pair?: QualityPair) {
    return this.personaRows.filter((p) => !pair || p.pair === pair).map((p) => ({ ...p }));
  }
  async texts(pair?: QualityPair) {
    return this.textRows.filter((t) => !pair || t.pair === pair).map((t) => ({ ...t }));
  }
  async addPersona(p: NewPersona) {
    const row: QualityPersona = { status: "new", seed_key: null, ...p, id: p.id ?? randomUUID(), created_at: this.now().toISOString() };
    this.personaRows.push(row);
    return { ...row };
  }
  async addText(t: NewText) {
    const row: QualityText = { status: "new", seed_key: null, ...t, id: t.id ?? randomUUID(), created_at: this.now().toISOString() };
    this.textRows.push(row);
    return { ...row };
  }
  async setStatus(kind: QualityKind, ids: string[], status: QualityStatus, onlyFrom?: QualityStatus) {
    const rows: { id: string; status: QualityStatus }[] = kind === "persona" ? this.personaRows : this.textRows;
    for (const r of rows) if (ids.includes(r.id) && (!onlyFrom || r.status === onlyFrom)) r.status = status;
  }
  async upsertSeed(personas: NewPersona[], texts: NewText[]) {
    let p = 0;
    let t = 0;
    for (const x of personas) {
      if (this.personaRows.some((r) => r.seed_key === x.seed_key)) continue;
      await this.addPersona(x);
      p += 1;
    }
    for (const x of texts) {
      if (this.textRows.some((r) => r.seed_key === x.seed_key)) continue;
      await this.addText(x);
      t += 1;
    }
    return { personas: p, texts: t };
  }
  async addRun(run: NewRun, items: NewItem[]) {
    const row: QualityRun = { ...run, id: randomUUID(), created_at: this.now().toISOString() };
    this.runRows.push(row);
    for (const i of items) this.itemRows.push({ ...i, id: randomUUID(), run_id: row.id });
    return { ...row };
  }
  async runs(pair: QualityPair, limit = 20) {
    return [...this.runRows].filter((r) => r.pair === pair).reverse().slice(0, limit);
  }
  async counters(pair: QualityPair) {
    const out = new Map<string, CardCounters>();
    for (const r of this.runRows.filter((x) => x.pair === pair)) {
      const c = out.get(r.ref_id) ?? { ...EMPTY_COUNTERS };
      if (r.status !== "error") c.runs += 1;
      if (!c.lastRunAt || r.created_at > c.lastRunAt) c.lastRunAt = r.created_at;
      out.set(r.ref_id, c);
    }
    return out;
  }
  async runSpendSince(since: Date) {
    return this.runRows.filter((r) => Date.parse(r.created_at) >= since.getTime()).reduce((s, r) => s + r.cost_usd, 0);
  }
}
