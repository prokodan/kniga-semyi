// #354 (v2 Q3, docs/v2/QUALITY_LOOP.md §2, §5.2): находки разбора отзывов — типы и чистая логика.
// Отзыв проверяющего (/review 2.0, таблицы review_*) → «единица разбора» (текст ссылки: правки абзацев, фокус-слова,
// оценки, комментарий) → шаг ИИ quality_analyze → находки по компонентам. Дубли сливаются: по duplicate_of из ответа
// модели и по отпечатку (компонент + «неверно → верно»). count — в скольких текстах нашли (не сколько раз разбирали).
// Без server-only: тот же код у /admin/quality, /api/cron/quality-digest, scripts/quality-propose.ts и тестов.
import type { AiOutput } from "@/lib/ai/types";

export const FINDING_COMPONENTS = ["prompt", "glossary", "check_rule", "names", "model_route"] as const;
export type FindingComponent = (typeof FINDING_COMPONENTS)[number];

export const COMPONENT_RU: Record<FindingComponent, string> = {
  prompt: "Промпт перевода",
  glossary: "Глоссарий",
  check_rule: "Правило проверки",
  names: "Словарь имён",
  model_route: "Модель",
};

/** Куда уходит правка компонента (для подписи в «Находках»). Маршруты моделей и код — только issue, не патч. */
export const COMPONENT_WHERE: Record<FindingComponent, string> = {
  prompt: "prompts/translate.<язык>.md",
  glossary: "content/packs/* (+ строка в промпте)",
  check_rule: "eval/kk-check.ts · eval/kr-check.ts",
  names: "промпт перевода + золотой набор",
  model_route: "только issue",
};

export const SEVERITIES = ["minor", "major", "critical"] as const;
export type FindingSeverity = (typeof SEVERITIES)[number];
export const SEVERITY_RU: Record<FindingSeverity, string> = { minor: "мелочь", major: "важно", critical: "критично" };
export const severityRank = (s: FindingSeverity) => SEVERITIES.indexOf(s);

export type FindingStatus = "new" | "proposed" | "dismissed";
export type ProposalStatus = "draft" | "eval" | "ready" | "approved" | "rejected";
export const PROPOSAL_RU: Record<ProposalStatus, string> = {
  draft: "строится",
  eval: "ждёт eval",
  ready: "eval готов",
  approved: "одобрено",
  rejected: "отклонено",
};

/** Сколько находок одного компонента в паре запускают quality-propose сами (§5.3, «≥ N»). */
export const AUTO_PROPOSE_MIN = 3;

export type FixKind = "prompt_rule" | "glossary" | "check_rule" | "name" | "route" | "none";
export interface FindingFix {
  kind: FixKind;
  rule: string;
  src: string;
  wrong: string;
  right: string;
}
export const EMPTY_FIX: FindingFix = { kind: "none", rule: "", src: "", wrong: "", right: "" };

/** Доказательство «было → правка носителя». edit — абзац; term — фокус-слово; note — только слова модели разбора. */
export interface FindingEvidence {
  kind: "edit" | "term" | "note";
  before: string;
  after: string;
  note?: string;
  /** Абзац оригинала (для правки абзаца) — нужен золотому набору */
  source?: string;
  paragraph?: number;
  item_id: string;
  link_id: string;
  feedback_id: string | null;
  /** Инициалы проверяющего («А. К.») */
  reviewer: string;
  reviewed_at: string;
  title?: string | null;
  persona?: string;
  prompt_version?: string | null;
}

export interface QualityFinding {
  id: string;
  feedback_id: string | null;
  feedback_ids: string[];
  item_ids: string[];
  link_ids: string[];
  pair: string;
  component: FindingComponent;
  severity: FindingSeverity;
  summary: string;
  evidence: FindingEvidence[];
  fix: FindingFix;
  fingerprint: string;
  count: number;
  status: FindingStatus;
  proposal_id: string | null;
  digest_id: string | null;
  created_at: string;
  updated_at: string;
}

export type FindingDraft = Omit<QualityFinding, "id" | "created_at" | "updated_at" | "status" | "proposal_id">;

/** Контракт с Q4 (#355): Q3 создаёт (draft → eval), Q4 читает и меняет status / eval_* / reject_reason. */
export interface QualityProposal {
  id: string;
  pair: string;
  findings: string[];
  components: string[];
  branch: string | null;
  pr_number: number | null;
  pr_url: string | null;
  files: string[];
  issues: number[];
  summary: string;
  eval_before: unknown;
  eval_after: unknown;
  status: ProposalStatus;
  reject_reason: string | null;
  trigger: string;
  run_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface QualityDigest {
  id: string;
  trigger: string;
  status: "running" | "ok" | "partial" | "budget" | "idle" | "error";
  items_seen: number;
  items_analyzed: number;
  findings_new: number;
  findings_merged: number;
  calls: number;
  cost_usd: number;
  proposed: { pair: string; component: string; count: number }[];
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

// ---------------- единица разбора: текст ссылки с отзывом ----------------

export interface RawFeedback {
  id: string;
  paragraph: number;
  edited_text: string | null;
  ratings: Record<string, unknown> | null;
  comment: string | null;
  skipped: boolean | null;
  terms: Record<string, { ok?: boolean | null; fix?: string | null }> | null;
  updated_at: string;
}
export interface RawUnit {
  link: { id: string; pair: string; reviewer_label: string };
  item: {
    id: string;
    kind?: string | null;
    title: string | null;
    source_text: string;
    model_text: string;
    persona: string;
    prompt_version: string | null;
    focus_terms: { term: string; hint?: string }[] | null;
  };
  feedback: RawFeedback[];
}

export interface ReviewUnit {
  item_id: string;
  link_id: string;
  pair: string;
  reviewer: string;
  title: string;
  persona: string;
  prompt_version: string | null;
  source: string;
  model: string;
  edits: { paragraph: number; source: string; before: string; after: string; feedback_id: string; at: string }[];
  terms: { term: string; hint: string; fix: string; feedback_id: string; at: string }[];
  ratings: Record<string, number>;
  comment: string;
  /** Отзыв на весь текст (paragraph = -1) — первый feedback_id находки, если правок нет */
  whole_id: string | null;
  /** Последняя отметка отзывов текста — по ней разбор понимает, что отзыв изменился */
  feedback_at: string;
}

export const paragraphsOf = (text: string) =>
  text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Последняя отметка отзывов текста (ISO) или null — отзыва нет. */
export function feedbackAt(fb: readonly RawFeedback[]): string | null {
  return fb.reduce<string | null>((m, f) => (!m || f.updated_at > m ? f.updated_at : m), null);
}

/**
 * Текст ссылки → что разбирать. null — разбирать нечего: нет настоящих правок, нет «неверно» у фокус-слов и нет
 * комментария (одни хорошие оценки или «пропустить») — такой текст отмечается разобранным без вызова ИИ.
 */
export function buildUnit(raw: RawUnit): ReviewUnit | null {
  if (raw.item.kind === "question") return null; // вопросы банка переводит не translate — промпты перевода тут ни при чём
  const fb = raw.feedback;
  const at = feedbackAt(fb);
  if (!at) return null;
  const src = paragraphsOf(raw.item.source_text);
  const tgt = paragraphsOf(raw.item.model_text);
  const edits: ReviewUnit["edits"] = [];
  for (const f of fb) {
    if (f.paragraph < 0 || !f.edited_text) continue;
    const before = tgt[f.paragraph] ?? "";
    if (squash(before) === squash(f.edited_text)) continue;
    edits.push({ paragraph: f.paragraph, source: src[f.paragraph] ?? "", before, after: f.edited_text.trim(), feedback_id: f.id, at: f.updated_at });
  }
  edits.sort((a, b) => a.paragraph - b.paragraph);
  const whole = fb.find((f) => f.paragraph === -1) ?? null;
  const focus = Array.isArray(raw.item.focus_terms) ? raw.item.focus_terms : [];
  const terms: ReviewUnit["terms"] = [];
  if (whole?.terms && typeof whole.terms === "object")
    for (const [k, v] of Object.entries(whole.terms)) {
      const t = focus[Number(k)];
      if (!t || !v || v.ok !== false) continue;
      terms.push({ term: t.term, hint: t.hint ?? "", fix: (v.fix ?? "").trim(), feedback_id: whole.id, at: whole.updated_at });
    }
  const ratings: Record<string, number> = {};
  for (const [k, v] of Object.entries(whole?.ratings ?? {})) if (typeof v === "number" && v >= 1 && v <= 5) ratings[k] = v;
  const comment = (whole?.comment ?? "").trim();
  if (!edits.length && !terms.length && !comment) return null;
  return {
    item_id: raw.item.id,
    link_id: raw.link.id,
    pair: raw.link.pair,
    reviewer: raw.link.reviewer_label,
    title: raw.item.title ?? "",
    persona: raw.item.persona,
    prompt_version: raw.item.prompt_version,
    source: raw.item.source_text,
    model: raw.item.model_text,
    edits,
    terms,
    ratings,
    comment,
    whole_id: whole?.id ?? null,
    feedback_at: at,
  };
}

/** Вход шага quality_analyze для пачки единиц одной пары; ref = i0, i1… */
export function analyzeInput(units: readonly ReviewUnit[], known: readonly Pick<QualityFinding, "id" | "component" | "summary">[]) {
  return {
    pair: units[0]!.pair,
    items: units.map((u, i) => ({
      ref: `i${i}`,
      title: u.title.slice(0, 200),
      source: u.source.slice(0, 6000),
      model: u.model.slice(0, 6000),
      edits: u.edits.slice(0, 20).map((e) => ({ paragraph: e.paragraph, source: e.source.slice(0, 2000), before: e.before.slice(0, 2000), after: e.after.slice(0, 2000) })),
      terms: u.terms.slice(0, 8).map((t) => ({ term: t.term.slice(0, 80), hint: t.hint.slice(0, 120), fix: t.fix.slice(0, 120) })),
      ratings: u.ratings,
      comment: u.comment.slice(0, 2000),
    })),
    known: known.slice(0, 40).map((k) => ({ id: k.id, component: k.component, summary: k.summary.slice(0, 400) })),
  };
}

// ---------------- ответ модели → черновики находок ----------------

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"'`.,!?;:()[\]{}—–-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Ключ слияния дублей: компонент + «неверно → верно»; без примера — слово оригинала и начало описания. */
export function fingerprint(component: FindingComponent, fix: Pick<FindingFix, "src" | "wrong" | "right">, summary: string): string {
  const w = norm(fix.wrong);
  const r = norm(fix.right);
  if (w || r) return `${component}:${w}→${r}`.slice(0, 300);
  return `${component}:${norm(fix.src)}:${norm(summary).slice(0, 80)}`.slice(0, 300);
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Доказательства находки — из самого отзыва (полные абзацы, id отзыва); слова модели разбора — если ничего не совпало. */
export function evidenceFor(unit: ReviewUnit, ai: { before: string; after: string; note: string }[], fix: FindingFix): FindingEvidence[] {
  const base = { item_id: unit.item_id, link_id: unit.link_id, reviewer: unit.reviewer, title: unit.title || null, persona: unit.persona, prompt_version: unit.prompt_version };
  const hits = (hay: string, needle: string) => {
    const n = squash(needle);
    return n.length >= 2 && squash(hay).includes(n.slice(0, 60));
  };
  const out: FindingEvidence[] = [];
  for (const e of unit.edits) {
    const byAi = ai.some((a) => (a.before && hits(e.before, a.before)) || (a.after && hits(e.after, a.after)));
    const byFix = Boolean(fix.wrong && fix.right && hits(e.before, fix.wrong) && hits(e.after, fix.right));
    if (byAi || byFix)
      out.push({ ...base, kind: "edit", before: e.before, after: e.after, source: e.source, paragraph: e.paragraph, feedback_id: e.feedback_id, reviewed_at: e.at });
  }
  for (const t of unit.terms) {
    const byAi = ai.some((a) => squash(a.before) === squash(t.term) || (a.after && squash(a.after) === squash(t.fix)));
    if (byAi || (fix.wrong && squash(fix.wrong) === squash(t.term)))
      out.push({ ...base, kind: "term", before: t.term, after: t.fix, note: t.hint, feedback_id: t.feedback_id, reviewed_at: t.at });
  }
  if (!out.length)
    for (const a of ai.slice(0, 3))
      if (a.before || a.after) out.push({ ...base, kind: "note", before: clip(a.before, 600), after: clip(a.after, 600), note: a.note || undefined, feedback_id: unit.whole_id, reviewed_at: unit.feedback_at });
  return out.slice(0, 8);
}

/** Ответ quality_analyze → черновики находок (по ref — к своему тексту). Неизвестный ref — пропускаем. */
export function draftsFrom(units: readonly ReviewUnit[], out: AiOutput<"quality_analyze">, digestId: string | null): { draft: FindingDraft; duplicateOf: string | null }[] {
  const byRef = new Map(units.map((u, i) => [`i${i}`, u]));
  const res: { draft: FindingDraft; duplicateOf: string | null }[] = [];
  for (const f of out.findings) {
    const u = byRef.get(f.item);
    if (!u) continue;
    const fix: FindingFix = { ...EMPTY_FIX, ...f.fix };
    const evidence = evidenceFor(u, f.evidence, fix);
    const fbIds = [...new Set(evidence.map((e) => e.feedback_id).filter((x): x is string => Boolean(x)))];
    const first = fbIds[0] ?? u.edits[0]?.feedback_id ?? u.whole_id;
    res.push({
      duplicateOf: f.duplicate_of,
      draft: {
        feedback_id: first ?? null,
        feedback_ids: fbIds.length ? fbIds : first ? [first] : [],
        item_ids: [u.item_id],
        link_ids: [u.link_id],
        pair: u.pair,
        component: f.component,
        severity: f.severity,
        summary: clip(f.summary.trim(), 400),
        evidence,
        fix,
        fingerprint: fingerprint(f.component, fix, f.summary),
        count: 1,
        digest_id: digestId,
      },
    });
  }
  return res;
}

const union = <T>(a: readonly T[], b: readonly T[]) => [...new Set([...a, ...b])];

function evKey(e: FindingEvidence) {
  return `${e.item_id}|${e.paragraph ?? ""}|${squash(e.before)}|${squash(e.after)}`;
}

/** Слить черновик в находку: тексты, ссылки, отзывы — объединением; важность — наибольшая; count — число текстов. */
export function mergeInto<T extends Omit<FindingDraft, "digest_id"> & { digest_id?: string | null }>(base: T, add: FindingDraft): T {
  const seen = new Set(base.evidence.map(evKey));
  const evidence = [...base.evidence];
  for (const e of add.evidence) {
    if (seen.has(evKey(e))) continue;
    seen.add(evKey(e));
    evidence.push(e);
  }
  const item_ids = union(base.item_ids, add.item_ids);
  return {
    ...base,
    feedback_ids: union(base.feedback_ids, add.feedback_ids),
    item_ids,
    link_ids: union(base.link_ids, add.link_ids),
    severity: severityRank(add.severity) > severityRank(base.severity) ? add.severity : base.severity,
    evidence: evidence.slice(-8),
    // правило / пример из более свежего разбора — если в старой находке его не было
    fix: base.fix.kind === "none" && add.fix.kind !== "none" ? add.fix : base.fix,
    count: Math.max(1, item_ids.length),
  };
}

export interface MergePlan {
  create: FindingDraft[];
  update: { id: string; patch: Omit<FindingDraft, "digest_id"> }[];
}

/**
 * Дубли: (1) duplicate_of — id существующей находки той же пары и компонента; (2) тот же отпечаток, что у существующей
 * (кроме скрытых — их не воскрешаем, но и новую не плодим); (3) одинаковые отпечатки внутри пачки — одной находкой.
 */
export function planMerge(existing: readonly QualityFinding[], incoming: readonly { draft: FindingDraft; duplicateOf: string | null }[]): MergePlan {
  const byId = new Map(existing.map((f) => [f.id, f]));
  const byFp = new Map(existing.map((f) => [`${f.pair}|${f.fingerprint}`, f]));
  const touched = new Map<string, QualityFinding>();
  const created = new Map<string, FindingDraft>();
  for (const { draft, duplicateOf } of incoming) {
    const dup = duplicateOf ? byId.get(duplicateOf) : undefined;
    const target = (dup && dup.pair === draft.pair && dup.component === draft.component ? dup : undefined) ?? byFp.get(`${draft.pair}|${draft.fingerprint}`);
    if (target) {
      const cur = touched.get(target.id) ?? target;
      touched.set(target.id, mergeInto(cur, draft));
      continue;
    }
    const k = `${draft.pair}|${draft.fingerprint}`;
    const prev = created.get(k);
    created.set(k, prev ? mergeInto(prev, draft) : draft);
  }
  return {
    create: [...created.values()],
    update: [...touched.values()].map((f) => {
      const { id, created_at: _c, updated_at: _u, status: _s, proposal_id: _p, digest_id: _d, ...patch } = f;
      void _c;
      void _u;
      void _s;
      void _p;
      void _d;
      return { id, patch };
    }),
  };
}

// ---------------- «Находки»: по компонентам ----------------

export interface ComponentGroup {
  component: FindingComponent;
  findings: QualityFinding[];
  /** Сколько раз нашли (сумма count) */
  hits: number;
  open: number;
  worst: FindingSeverity | null;
}

export function groupByComponent(findings: readonly QualityFinding[]): ComponentGroup[] {
  return FINDING_COMPONENTS.map((component) => {
    const fs = findings
      .filter((f) => f.component === component)
      .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.count - a.count || b.updated_at.localeCompare(a.updated_at));
    const open = fs.filter((f) => f.status === "new");
    const worst = open.reduce<FindingSeverity | null>((m, f) => (!m || severityRank(f.severity) > severityRank(m) ? f.severity : m), null);
    return { component, findings: fs, hits: fs.reduce((s, f) => s + f.count, 0), open: open.length, worst };
  });
}

/** Группы (пара, компонент), где новых находок ≥ min — их quality-propose запускает сам. */
export function autoProposeGroups(findings: readonly QualityFinding[], min = AUTO_PROPOSE_MIN): { pair: string; component: FindingComponent; count: number }[] {
  const m = new Map<string, { pair: string; component: FindingComponent; count: number }>();
  for (const f of findings) {
    if (f.status !== "new") continue;
    const k = `${f.pair}|${f.component}`;
    const g = m.get(k) ?? { pair: f.pair, component: f.component, count: 0 };
    g.count += 1;
    m.set(k, g);
  }
  return [...m.values()].filter((g) => g.count >= min);
}

export function isFindingComponent(v: unknown): v is FindingComponent {
  return typeof v === "string" && (FINDING_COMPONENTS as readonly string[]).includes(v);
}
