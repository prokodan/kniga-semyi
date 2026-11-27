// #232: формат выгрузки отзывов носителей (eval/reviews/*.md), золотой набор (eval/golden/<пара>.jsonl),
// набор глав прогона eval для ссылок (eval/reviews/sets/*.json). Чистые функции — скрипт выгрузки, eval и тесты.
import { createHash } from "node:crypto";
import { alignParagraphs, isRealEdit, labelSlug } from "@/app/admin/reviews/_lib/core";
import type { Chapter } from "@/eval/sim/run";
import { REVIEW_AXES, type ReviewAxis, type ReviewFeedback, type ReviewItem, type ReviewLink } from "@/lib/types";

// ---------------- набор глав прогона eval ----------------

export interface ReviewSetFile {
  /** Имя набора: в ссылке items_set = eval:<name> */
  name: string;
  /** ru-ko | ru-kk */
  pair: string;
  /** Дата прогона (YYYY-MM-DD) */
  created: string;
  items: { persona: string; title: string; source: string; model: string; prompt_version: string }[];
}

/**
 * #257: главы прогона → тексты набора для носителей. ru-ko — русская глава и её корейский перевод; ru-kk — только
 * главы, где казахский — перевод ИИ с русского (рассказ по-казахски — оригинал, носителю его править не нужно).
 */
export function reviewSetItems(persona: string, chapters: Pick<Chapter, "title" | "text_ru" | "text_ko" | "text_kk" | "original" | "error">[], pair: string, versions: Record<string, string>): ReviewSetFile["items"] {
  const out: ReviewSetFile["items"] = [];
  for (const c of chapters) {
    if (c.error || !c.text_ru) continue;
    if (pair === "ru-kk") {
      if (c.original !== "ru" || !c.text_kk) continue;
      out.push({ persona, title: c.title ?? "", source: c.text_ru, model: c.text_kk, prompt_version: `translate.kk ${versions["translate.kk"] ?? "?"}` });
    } else if (c.text_ko) out.push({ persona, title: c.title ?? "", source: c.text_ru, model: c.text_ko, prompt_version: `translate ${versions.translate ?? "?"}` });
  }
  return out;
}

// ---------------- выгрузка ----------------

export const AXIS_RU: Record<ReviewAxis, string> = {
  meaning: "смысл",
  grammar: "грамматика",
  natural: "естественно",
  respect: "к старшим",
  names: "имена и реалии",
};

export interface ExportLink {
  link: ReviewLink;
  items: ReviewItem[];
  feedback: ReviewFeedback[];
}

/** eval/reviews/<дата создания ссылки>-<пара>-<инициалы>.md; одинаковые — с началом id ссылки. */
export function reviewFileName(link: Pick<ReviewLink, "id" | "created_at" | "pair" | "reviewer_label">, taken?: Set<string>): string {
  const base = `${link.created_at.slice(0, 10)}-${link.pair}-${labelSlug(link.reviewer_label)}`;
  let name = `${base}.md`;
  if (taken?.has(name)) name = `${base}-${link.id.slice(0, 6)}.md`;
  taken?.add(name);
  return name;
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n+/g, " ");

/** Пословный diff: «~~было~~ **стало**». LCS по словам; для длинных абзацев (> 400 слов) — целиком. */
export function wordDiff(before: string, after: string): string {
  const a = before.split(/\s+/).filter(Boolean);
  const b = after.split(/\s+/).filter(Boolean);
  if (a.length * b.length > 160_000) return `~~${before}~~ **${after}**`;
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: string[] = [];
  let del: string[] = [];
  let ins: string[] = [];
  const flush = () => {
    if (del.length) out.push(`~~${del.join(" ")}~~`);
    if (ins.length) out.push(`**${ins.join(" ")}**`);
    del = [];
    ins = [];
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flush();
      out.push(a[i]!);
      i++;
      j++;
    } else if (j < b.length && (i >= a.length || dp[i]![j + 1]! >= dp[i + 1]![j]!)) ins.push(b[j++]!);
    else del.push(a[i++]!);
  }
  flush();
  return out.join(" ");
}

function ratingsLine(r: ReviewFeedback["ratings"]): string {
  const parts = REVIEW_AXES.filter((a) => typeof r[a] === "number").map((a) => `${AXIS_RU[a]} ${r[a]}`);
  return parts.length ? parts.join(" · ") : "—";
}

/** Markdown одной ссылки: что показали, правки абзацев (diff), оценки, комментарии. */
export function renderReviewMarkdown({ link, items, feedback }: ExportLink): string {
  const byItem = new Map<string, ReviewFeedback[]>();
  for (const f of feedback) (byItem.get(f.item_id) ?? byItem.set(f.item_id, []).get(f.item_id)!).push(f);
  const sorted = [...items].sort((x, y) => x.position - y.position);
  const reviewed = sorted.filter((i) => byItem.has(i.id));
  const out: string[] = [
    `# Отзывы носителя · ${link.pair} · ${link.reviewer_label}`,
    "",
    `- Ссылка: ${link.id.slice(0, 8)} · режим ${link.mode === "texts" ? "тексты" : "вопросы"} · набор \`${link.items_set}\` · создана ${link.created_at.slice(0, 10)}`,
    `- Проверено: ${reviewed.length} из ${items.length}. Все тексты вымышленные (eval-персонажи, демо, вопросы банка).`,
    "- Правки абзацев — в золотом наборе `eval/golden/" + link.pair + ".jsonl` (слияние этого PR = правки приняты).",
    "",
  ];
  const allRatings = feedback.filter((f) => f.paragraph < 0);
  const avgParts = REVIEW_AXES.map((a) => {
    const vs = allRatings.map((f) => f.ratings[a]).filter((v): v is number => typeof v === "number");
    return vs.length ? `${AXIS_RU[a]} ${(vs.reduce((s, v) => s + v, 0) / vs.length).toFixed(1)}` : null;
  }).filter(Boolean);
  if (avgParts.length) out.push(`**Средние оценки:** ${avgParts.join(" · ")}`, "");

  for (const item of reviewed) {
    const fb = byItem.get(item.id)!;
    const whole = fb.find((f) => f.paragraph < 0);
    out.push(`## ${item.position + 1}. ${item.title ?? (item.kind === "question" ? "Вопрос" : "Глава")} · ${item.persona}`, "");
    out.push(`- Версия промпта: ${item.prompt_version ?? "—"}`);
    out.push(`- Оценки: ${whole ? ratingsLine(whole.ratings) : "—"}${whole?.skipped ? " · ⏭ пропущено («не знаю»)" : ""}`);
    if (whole?.comment) out.push(`- Комментарий к тексту: ${cell(whole.comment)}`);
    out.push("");
    const paras = alignParagraphs(item.source_text, item.model_text);
    const pfb = fb.filter((f) => f.paragraph >= 0).sort((x, y) => x.paragraph - y.paragraph);
    for (const f of pfb) {
      const p = paras[f.paragraph];
      if (!p) continue;
      const edit = isRealEdit(p.target, f.edited_text);
      if (!edit && !f.comment) continue;
      out.push(`### Абзац ${f.paragraph + 1}`, "");
      out.push(`> ${cell(p.source)}`, "");
      if (edit) {
        out.push("```diff", `- ${cell(p.target)}`, `+ ${cell(f.edited_text!)}`, "```", "");
        out.push(`Пословно: ${wordDiff(p.target, f.edited_text!)}`, "");
      } else out.push(`Перевод модели: ${cell(p.target)}`, "");
      if (f.comment) out.push(`💬 ${cell(f.comment)}`, "");
    }
  }
  if (!reviewed.length) out.push("_Отзывов пока нет._", "");
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

// ---------------- золотой набор ----------------

export interface GoldenEntry {
  /** sha256(пара + оригинал абзаца + текст модели)[:16] — одна строка на абзац; новая правка того же абзаца заменяет старую */
  key: string;
  pair: string;
  kind: "chapter" | "question";
  persona: string;
  title: string | null;
  /** Абзац оригинала */
  source: string;
  /** Перевод модели, который правил носитель */
  model: string;
  /** Правка носителя — эталон */
  gold: string;
  prompt_version: string | null;
  reviewer: string;
  reviewed_at: string;
  comment?: string;
}

export function goldenKey(pair: string, source: string, model: string): string {
  return createHash("sha256").update(`${pair}\n${source}\n${model}`).digest("hex").slice(0, 16);
}

/** Правки абзацев ссылки → строки золотого набора (только настоящие правки). */
export function goldenFromLink({ link, items, feedback }: ExportLink): GoldenEntry[] {
  const out: GoldenEntry[] = [];
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const f of feedback) {
    if (f.paragraph < 0) continue;
    const item = byId.get(f.item_id);
    if (!item) continue;
    const p = alignParagraphs(item.source_text, item.model_text)[f.paragraph];
    if (!p || !p.source || !isRealEdit(p.target, f.edited_text)) continue;
    out.push({
      key: goldenKey(link.pair, p.source, p.target),
      pair: link.pair,
      kind: item.kind,
      persona: item.persona,
      title: item.title,
      source: p.source,
      model: p.target,
      gold: f.edited_text!.trim(),
      prompt_version: item.prompt_version,
      reviewer: link.reviewer_label,
      reviewed_at: f.updated_at,
      ...(f.comment ? { comment: f.comment } : {}),
    });
  }
  return out;
}

export function parseGolden(jsonl: string): GoldenEntry[] {
  return jsonl
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as GoldenEntry);
}

/** Слить новые строки с файлом: по key, более поздняя правка побеждает; порядок — старые на местах, новые в конце. */
export function mergeGolden(existing: GoldenEntry[], incoming: GoldenEntry[]): GoldenEntry[] {
  const out = [...existing];
  const idx = new Map(out.map((e, i) => [e.key, i]));
  for (const e of incoming) {
    const i = idx.get(e.key);
    if (i === undefined) {
      idx.set(e.key, out.length);
      out.push(e);
    } else if (e.reviewed_at >= out[i]!.reviewed_at) out[i] = e;
  }
  return out;
}

export const renderGolden = (entries: GoldenEntry[]) => entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : "");

// ---------------- сверка с золотым набором (eval) ----------------

/** chrF (символьные n-граммы 1–6, F-мера β = 2) — насколько текст близок к эталону, 0…1. Без ИИ, хорошо работает для ko / kk. */
export function chrF(hyp: string, ref: string, maxN = 6, beta = 2): number {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const h = norm(hyp);
  const r = norm(ref);
  if (!h || !r) return h === r ? 1 : 0;
  let p = 0;
  let rc = 0;
  let n = 0;
  for (let k = 1; k <= maxN; k++) {
    const grams = (s: string) => {
      const m = new Map<string, number>();
      for (let i = 0; i + k <= s.length; i++) {
        const g = s.slice(i, i + k);
        m.set(g, (m.get(g) ?? 0) + 1);
      }
      return m;
    };
    const hg = grams(h);
    const rg = grams(r);
    const ht = [...hg.values()].reduce((s, v) => s + v, 0);
    const rt = [...rg.values()].reduce((s, v) => s + v, 0);
    if (!ht || !rt) continue;
    let match = 0;
    for (const [g, c] of hg) match += Math.min(c, rg.get(g) ?? 0);
    p += match / ht;
    rc += match / rt;
    n++;
  }
  if (!n) return 0;
  p /= n;
  rc /= n;
  if (!p && !rc) return 0;
  const b2 = beta * beta;
  return ((1 + b2) * p * rc) / (b2 * p + rc);
}

/** Числа (годы, возраст, количества) эталона, которых нет в новом переводе — «хуже по фактам». */
export function missingNumbers(gold: string, hyp: string): string[] {
  const nums = (s: string) => s.match(/\d+/g) ?? [];
  const have = new Set(nums(hyp));
  return [...new Set(nums(gold))].filter((x) => !have.has(x));
}

export interface GoldenVerdict {
  key: string;
  persona: string;
  /** chrF(перевод модели, правка носителя) — как было при проверке */
  before: number;
  /** chrF(новый перевод, правка носителя) */
  after: number;
  verdict: "closer" | "same" | "farther";
  missing: string[];
  /** #256: чем решили «ближе / дальше» — судья ИИ (по смыслу) или chrF (судья недоступен / mock) */
  method: "judge" | "chrF";
  /** #256: оценки судьи по смыслу к правке носителя (1–5): old — перевод, который правил носитель, new — новый */
  judge?: { old: number; new: number; lost: string[]; comment: string };
}

export const GOLDEN_EPS = 0.02;

export function judgeGolden(e: GoldenEntry, fresh: string): GoldenVerdict {
  const before = chrF(e.model, e.gold);
  const after = chrF(fresh, e.gold);
  const verdict = after > before + GOLDEN_EPS ? "closer" : after < before - GOLDEN_EPS ? "farther" : "same";
  return { key: e.key, persona: e.persona, before, after, verdict, missing: missingNumbers(e.gold, fresh), method: "chrF" };
}

// ---------------- судья ИИ (#256) ----------------

/**
 * Порядок переводов для судьи: x / y — какой из них новый. Детерминированно по ключу абзаца (повтор = тот же вход =
 * кэш), но в половине абзацев новый перевод идёт первым — чтобы судья не тянул к одной позиции.
 */
export function goldenNewIsX(key: string): boolean {
  return parseInt(createHash("sha256").update(`order:${key}`).digest("hex").slice(0, 2), 16) % 2 === 0;
}

export interface GoldenJudgeItem {
  id: string;
  source: string;
  gold: string;
  x: string;
  y: string;
}

export function goldenJudgeItem(e: GoldenEntry, fresh: string): GoldenJudgeItem {
  const newIsX = goldenNewIsX(e.key);
  return { id: e.key, source: e.source, gold: e.gold, x: newIsX ? fresh : e.model, y: newIsX ? e.model : fresh };
}

export interface GoldenJudgeScore {
  id: string;
  x: number;
  y: number;
  lost_x?: string[];
  lost_y?: string[];
  comment?: string;
}

/**
 * Ответ судьи → вердикт «ближе / дальше» по смыслу. Новый перевод ниже по смыслу, чем тот, что правил носитель, или
 * потерял факт правки, который старый сохранял, — «дальше» и 🔴 по фактам (`missing`). chrF остаётся для справки.
 */
export function applyJudge(v: GoldenVerdict, s: GoldenJudgeScore): GoldenVerdict {
  const newIsX = goldenNewIsX(v.key);
  const now = newIsX ? s.x : s.y;
  const old = newIsX ? s.y : s.x;
  const lostNew = (newIsX ? s.lost_x : s.lost_y) ?? [];
  const lostOld = new Set(((newIsX ? s.lost_y : s.lost_x) ?? []).map((l) => l.trim().toLowerCase()));
  const lost = lostNew.map((l) => l.trim()).filter((l) => l && !lostOld.has(l.toLowerCase()));
  const verdict = now > old ? "closer" : now < old ? "farther" : "same";
  const missing = [...v.missing, ...(verdict === "farther" ? [`смысл ${now} < ${old}`] : []), ...lost];
  return { ...v, verdict, missing: [...new Set(missing)], method: "judge", judge: { old, new: now, lost, comment: s.comment ?? "" } };
}

/** Строка в комментарий eval: «Носители (ru-ko): ближе N / дальше M / как было K»; потерянные факты и «хуже по смыслу» — 🔴. */
export function goldenLine(pair: string, verdicts: GoldenVerdict[], skipped = 0): string {
  if (!verdicts.length) return `- **Носители (${pair}):** ${skipped ? `не проверено (${skipped} абзацев пропущено)` : "золотой набор пуст"}`;
  const c = (v: GoldenVerdict["verdict"]) => verdicts.filter((x) => x.verdict === v).length;
  const facts = verdicts.filter((v) => v.missing.length);
  const mark = facts.length ? "🔴" : c("farther") > c("closer") ? "🟡" : "🟢";
  const judged = verdicts.filter((v) => v.method === "judge").length;
  const how = judged === verdicts.length ? "судья ИИ по смыслу" : judged ? `судья ИИ ${judged}, chrF ${verdicts.length - judged}` : "chrF — судья недоступен";
  const tail = facts.length ? ` · 🔴 по фактам: ${facts.map((f) => `${f.persona} (${f.missing.map((m) => (/^\d+$/.test(m) ? `нет ${m}` : m)).join(", ")})`).join("; ")}` : "";
  return `- ${mark} **Носители (${pair}):** ближе ${c("closer")} / дальше ${c("farther")} / как было ${c("same")} из ${verdicts.length}${skipped ? ` (+${skipped} не проверено)` : ""} · ${how}${tail}`;
}
