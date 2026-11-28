// #354: хранилище разбора отзывов — Supabase (service-ключ) или память (тесты, локально без базы).
// Читает ссылки / тексты / отзывы проверяющих (review_*, #232 + #353), пишет quality_findings / quality_digests /
// quality_digest_items / quality_proposals. Без server-only: тот же код у scripts/quality-propose.ts.
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FindingDraft, FindingStatus, QualityDigest, QualityFinding, QualityProposal, RawUnit } from "./findings";

export type NewProposal = Pick<QualityProposal, "pair" | "findings" | "components" | "summary" | "trigger"> & Partial<Pick<QualityProposal, "run_id" | "status">>;
export type ProposalPatch = Partial<Pick<QualityProposal, "branch" | "pr_number" | "pr_url" | "files" | "issues" | "summary" | "status" | "error">>;

export interface DigestRepo {
  /** Тексты ссылок с отзывами (новые ссылки сверху); linkId — только эта ссылка */
  reviewUnits(opts?: { linkId?: string; limit?: number }): Promise<RawUnit[]>;
  /** item_id → отметка отзыва, которую разбор уже видел */
  seen(itemIds: string[]): Promise<Map<string, string>>;
  markSeen(rows: { item_id: string; feedback_at: string; digest_id: string; findings: number }[]): Promise<void>;
  findings(opts?: { pair?: string; statuses?: FindingStatus[]; ids?: string[] }): Promise<QualityFinding[]>;
  insertFindings(drafts: FindingDraft[]): Promise<QualityFinding[]>;
  updateFinding(id: string, patch: Partial<Omit<QualityFinding, "id" | "created_at" | "updated_at">>): Promise<void>;
  setFindingStatus(ids: string[], status: FindingStatus, proposalId?: string | null): Promise<void>;
  /** null — уже идёт другой разбор (моложе 3 мин) */
  startDigest(trigger: string): Promise<QualityDigest | null>;
  finishDigest(id: string, patch: Partial<Omit<QualityDigest, "id" | "started_at">>): Promise<void>;
  digests(limit?: number): Promise<QualityDigest[]>;
  /** $ шага quality_analyze (ai_usage) с момента since — лимит разбора на сутки */
  spentSince(since: Date): Promise<number>;
  addProposal(p: NewProposal): Promise<QualityProposal>;
  updateProposal(id: string, patch: ProposalPatch): Promise<void>;
  proposals(opts?: { pair?: string; limit?: number }): Promise<QualityProposal[]>;
}

const F_COLS =
  "id, feedback_id, feedback_ids, item_ids, link_ids, pair, component, severity, summary, evidence, fix, fingerprint, count, status, proposal_id, digest_id, created_at, updated_at";
const D_COLS = "id, trigger, status, items_seen, items_analyzed, findings_new, findings_merged, calls, cost_usd, proposed, error, started_at, finished_at";
const P_COLS =
  "id, pair, findings, components, branch, pr_number, pr_url, files, issues, summary, eval_before, eval_after, status, reject_reason, trigger, run_id, error, created_at, updated_at";
/** Разбор, который не отчитался за это время, считаем упавшим (лимит функции 60 с, workflow — свои 10 мин) */
export const DIGEST_STALE_MS = 3 * 60_000;

const chunks = <T>(xs: T[], n = 100): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

const normF = (f: QualityFinding): QualityFinding => ({
  ...f,
  feedback_ids: f.feedback_ids ?? [],
  item_ids: f.item_ids ?? [],
  link_ids: f.link_ids ?? [],
  evidence: Array.isArray(f.evidence) ? f.evidence : [],
  fix: { kind: "none", rule: "", src: "", wrong: "", right: "", ...(f.fix ?? {}) },
});
const normD = (d: QualityDigest): QualityDigest => ({ ...d, cost_usd: Number(d.cost_usd ?? 0), proposed: Array.isArray(d.proposed) ? d.proposed : [] });

export class SupabaseDigestRepo implements DigestRepo {
  constructor(private readonly db: SupabaseClient) {}

  async reviewUnits(opts: { linkId?: string; limit?: number } = {}): Promise<RawUnit[]> {
    let q = this.db.from("review_links").select("id, pair, reviewer_label").order("created_at", { ascending: false });
    if (opts.linkId) q = q.eq("id", opts.linkId);
    const { data: links, error } = await q.limit(opts.limit ?? 60);
    if (error) throw new Error(`review_links: ${error.message}`);
    const ls = (links ?? []) as RawUnit["link"][];
    if (!ls.length) return [];
    const items: (RawUnit["item"] & { link_id: string })[] = [];
    for (const part of chunks(ls.map((l) => l.id))) {
      const { data, error: e2 } = await this.db
        .from("review_items")
        .select("id, link_id, kind, title, source_text, model_text, persona, prompt_version, focus_terms")
        .in("link_id", part);
      if (e2) throw new Error(`review_items: ${e2.message}`);
      items.push(...((data ?? []) as (RawUnit["item"] & { link_id: string })[]));
    }
    const fb = new Map<string, RawUnit["feedback"]>();
    for (const part of chunks(items.map((i) => i.id))) {
      const { data, error: e3 } = await this.db
        .from("review_feedback")
        .select("id, item_id, paragraph, edited_text, ratings, comment, skipped, terms, updated_at")
        .in("item_id", part);
      if (e3) throw new Error(`review_feedback: ${e3.message}`);
      for (const f of (data ?? []) as (RawUnit["feedback"][number] & { item_id: string })[]) {
        const list = fb.get(f.item_id) ?? [];
        list.push(f);
        fb.set(f.item_id, list);
      }
    }
    const byLink = new Map(ls.map((l) => [l.id, l]));
    return items.filter((i) => fb.has(i.id)).map((i) => ({ link: byLink.get(i.link_id)!, item: i, feedback: fb.get(i.id)! }));
  }

  async seen(itemIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const part of chunks(itemIds)) {
      const { data, error } = await this.db.from("quality_digest_items").select("item_id, feedback_at").in("item_id", part);
      if (error) throw new Error(`quality_digest_items: ${error.message}`);
      for (const r of (data ?? []) as { item_id: string; feedback_at: string }[]) out.set(r.item_id, r.feedback_at);
    }
    return out;
  }

  async markSeen(rows: { item_id: string; feedback_at: string; digest_id: string; findings: number }[]): Promise<void> {
    if (!rows.length) return;
    const { error } = await this.db
      .from("quality_digest_items")
      .upsert(rows.map((r) => ({ ...r, analyzed_at: new Date().toISOString() })), { onConflict: "item_id" });
    if (error) throw new Error(`quality_digest_items: ${error.message}`);
  }

  async findings(opts: { pair?: string; statuses?: FindingStatus[]; ids?: string[] } = {}): Promise<QualityFinding[]> {
    let q = this.db.from("quality_findings").select(F_COLS).order("updated_at", { ascending: false });
    if (opts.pair) q = q.eq("pair", opts.pair);
    if (opts.statuses?.length) q = q.in("status", opts.statuses);
    if (opts.ids?.length) q = q.in("id", opts.ids);
    const { data, error } = await q.limit(500);
    if (error) throw new Error(`quality_findings: ${error.message}`);
    return ((data ?? []) as QualityFinding[]).map(normF);
  }

  async insertFindings(drafts: FindingDraft[]): Promise<QualityFinding[]> {
    if (!drafts.length) return [];
    const { data, error } = await this.db.from("quality_findings").insert(drafts).select(F_COLS);
    if (error) throw new Error(`quality_findings: ${error.message}`);
    return ((data ?? []) as QualityFinding[]).map(normF);
  }

  async updateFinding(id: string, patch: Partial<Omit<QualityFinding, "id" | "created_at" | "updated_at">>): Promise<void> {
    const { error } = await this.db.from("quality_findings").update(patch).eq("id", id);
    if (error) throw new Error(`quality_findings: ${error.message}`);
  }

  async setFindingStatus(ids: string[], status: FindingStatus, proposalId?: string | null): Promise<void> {
    for (const part of chunks(ids)) {
      const patch: Record<string, unknown> = { status };
      if (proposalId !== undefined) patch.proposal_id = proposalId;
      const { error } = await this.db.from("quality_findings").update(patch).in("id", part);
      if (error) throw new Error(`quality_findings: ${error.message}`);
    }
  }

  async startDigest(trigger: string): Promise<QualityDigest | null> {
    const stale = new Date(Date.now() - DIGEST_STALE_MS).toISOString();
    await this.db.from("quality_digests").update({ status: "error", error: "разбор не завершился (лимит функции?)", finished_at: new Date().toISOString() }).eq("status", "running").lt("started_at", stale);
    const { data: busy, error } = await this.db.from("quality_digests").select("id").eq("status", "running").gte("started_at", stale).limit(1);
    if (error) throw new Error(`quality_digests: ${error.message}`);
    if ((busy ?? []).length) return null;
    const { data, error: e2 } = await this.db.from("quality_digests").insert({ trigger }).select(D_COLS).single();
    if (e2) throw new Error(`quality_digests: ${e2.message}`);
    return normD(data as QualityDigest);
  }

  async finishDigest(id: string, patch: Partial<Omit<QualityDigest, "id" | "started_at">>): Promise<void> {
    const { error } = await this.db.from("quality_digests").update({ finished_at: new Date().toISOString(), ...patch }).eq("id", id);
    if (error) throw new Error(`quality_digests: ${error.message}`);
  }

  async digests(limit = 10): Promise<QualityDigest[]> {
    const { data, error } = await this.db.from("quality_digests").select(D_COLS).order("started_at", { ascending: false }).limit(limit);
    if (error) throw new Error(`quality_digests: ${error.message}`);
    return ((data ?? []) as QualityDigest[]).map(normD);
  }

  async spentSince(since: Date): Promise<number> {
    const { data, error } = await this.db.from("ai_usage").select("cost_usd").eq("step", "quality_analyze").gte("created_at", since.toISOString()).limit(5000);
    if (error) throw new Error(`ai_usage: ${error.message}`);
    return (data ?? []).reduce((s, r) => s + Number((r as { cost_usd: unknown }).cost_usd ?? 0), 0);
  }

  async addProposal(p: NewProposal): Promise<QualityProposal> {
    const { data, error } = await this.db.from("quality_proposals").insert(p).select(P_COLS).single();
    if (error) throw new Error(`quality_proposals: ${error.message}`);
    return data as QualityProposal;
  }

  async updateProposal(id: string, patch: ProposalPatch): Promise<void> {
    const { error } = await this.db.from("quality_proposals").update(patch).eq("id", id);
    if (error) throw new Error(`quality_proposals: ${error.message}`);
  }

  async proposals(opts: { pair?: string; limit?: number } = {}): Promise<QualityProposal[]> {
    let q = this.db.from("quality_proposals").select(P_COLS).order("created_at", { ascending: false });
    if (opts.pair) q = q.eq("pair", opts.pair);
    const { data, error } = await q.limit(opts.limit ?? 20);
    if (error) throw new Error(`quality_proposals: ${error.message}`);
    return (data ?? []) as QualityProposal[];
  }
}

/** Память процесса: тесты и локально без Supabase (ссылки — через addUnit). */
export class MemoryDigestRepo implements DigestRepo {
  readonly units: RawUnit[] = [];
  readonly seenRows = new Map<string, string>();
  readonly findingRows: QualityFinding[] = [];
  readonly digestRows: QualityDigest[] = [];
  readonly proposalRows: QualityProposal[] = [];
  spent = 0;
  constructor(private readonly now: () => Date = () => new Date()) {}

  addUnit(u: RawUnit) {
    this.units.push(u);
  }
  async reviewUnits(opts: { linkId?: string } = {}) {
    return this.units.filter((u) => !opts.linkId || u.link.id === opts.linkId);
  }
  async seen(itemIds: string[]) {
    return new Map([...this.seenRows].filter(([k]) => itemIds.includes(k)));
  }
  async markSeen(rows: { item_id: string; feedback_at: string }[]) {
    for (const r of rows) this.seenRows.set(r.item_id, r.feedback_at);
  }
  async findings(opts: { pair?: string; statuses?: FindingStatus[]; ids?: string[] } = {}) {
    return this.findingRows
      .filter((f) => (!opts.pair || f.pair === opts.pair) && (!opts.statuses?.length || opts.statuses.includes(f.status)) && (!opts.ids?.length || opts.ids.includes(f.id)))
      .map((f) => structuredClone(f));
  }
  async insertFindings(drafts: FindingDraft[]) {
    const at = this.now().toISOString();
    const rows = drafts.map((d) => ({ ...structuredClone(d), id: randomUUID(), status: "new" as const, proposal_id: null, created_at: at, updated_at: at }));
    this.findingRows.push(...rows);
    return rows.map((r) => structuredClone(r));
  }
  async updateFinding(id: string, patch: Partial<QualityFinding>) {
    const f = this.findingRows.find((x) => x.id === id);
    if (f) Object.assign(f, structuredClone(patch), { updated_at: this.now().toISOString() });
  }
  async setFindingStatus(ids: string[], status: FindingStatus, proposalId?: string | null) {
    for (const f of this.findingRows)
      if (ids.includes(f.id)) {
        f.status = status;
        if (proposalId !== undefined) f.proposal_id = proposalId;
      }
  }
  async startDigest(trigger: string) {
    const stale = this.now().getTime() - DIGEST_STALE_MS;
    if (this.digestRows.some((d) => d.status === "running" && Date.parse(d.started_at) >= stale)) return null;
    const d: QualityDigest = {
      id: randomUUID(),
      trigger,
      status: "running",
      items_seen: 0,
      items_analyzed: 0,
      findings_new: 0,
      findings_merged: 0,
      calls: 0,
      cost_usd: 0,
      proposed: [],
      error: null,
      started_at: this.now().toISOString(),
      finished_at: null,
    };
    this.digestRows.push(d);
    return { ...d };
  }
  async finishDigest(id: string, patch: Partial<QualityDigest>) {
    const d = this.digestRows.find((x) => x.id === id);
    if (d) Object.assign(d, patch, { finished_at: this.now().toISOString() });
  }
  async digests(limit = 10) {
    return [...this.digestRows].reverse().slice(0, limit);
  }
  async spentSince() {
    return this.spent;
  }
  async addProposal(p: NewProposal) {
    const at = this.now().toISOString();
    const row: QualityProposal = {
      branch: null,
      pr_number: null,
      pr_url: null,
      files: [],
      issues: [],
      eval_before: null,
      eval_after: null,
      status: "draft",
      reject_reason: null,
      run_id: null,
      error: null,
      ...p,
      id: randomUUID(),
      created_at: at,
      updated_at: at,
    };
    this.proposalRows.push(row);
    return { ...row };
  }
  async updateProposal(id: string, patch: ProposalPatch) {
    const p = this.proposalRows.find((x) => x.id === id);
    if (p) Object.assign(p, patch);
  }
  async proposals(opts: { pair?: string; limit?: number } = {}) {
    return [...this.proposalRows].reverse().filter((p) => !opts.pair || p.pair === opts.pair).slice(0, opts.limit ?? 20);
  }
}
