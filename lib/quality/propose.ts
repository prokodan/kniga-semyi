// #354 (docs/v2/QUALITY_LOOP.md §5.3, §6): quality-propose — находки → патч ТОЛЬКО в разрешённых файлах:
//   prompts/translate.<язык>.md       — правила из отзывов носителей (раздел перед «title …»), строки глоссария и имён;
//   content/packs/<пакет>/*            — термин глоссария пакета (kz: KZ_GLOSSARY; корейский глоссарий — docs/glossary.md,
//                                        вне списка → только строка в промпте);
//   eval/kk-check.ts, eval/kr-check.ts — правило проверки «неверно → верно» (REVIEW_RULES_KK / REVIEW_RULES_KO);
//   eval/golden/<пара>.jsonl           — правки носителя → золотой набор (формат eval/reviews/format.ts).
// Код конвейера и маршруты моделей — только issue, не патч. Патч вне разрешённых файлов — отказ (PatchRefusedError):
// проверяет и этот модуль, и scripts/quality-propose.ts по `git status` перед коммитом.
// Чистые функции — без git, сети и базы (тест lib/quality/propose.test.ts).
import { goldenKey, mergeGolden, parseGolden, renderGolden, type GoldenEntry } from "@/eval/reviews/format";
import { COMPONENT_RU, SEVERITY_RU, type FindingComponent, type FindingFix, type QualityFinding } from "./findings";

// ---------------- разрешённые файлы ----------------

export const ALLOWED_PATCH_PATHS: readonly RegExp[] = [
  /^prompts\/translate\.[a-z]{2}\.md$/,
  /^content\/packs\/[a-z0-9_-]+\/[a-z0-9_-]+(\.[a-z0-9_-]+)*\.(ts|json|md)$/,
  /^eval\/kk-check\.ts$/,
  /^eval\/kr-check\.ts$/,
  /^eval\/golden\/[a-z]{2}-[a-z]{2}\.jsonl$/,
];

export class PatchRefusedError extends Error {
  constructor(readonly paths: string[]) {
    super(`quality-propose: патч вне разрешённых файлов — отказ: ${paths.join(", ")}`);
    this.name = "PatchRefusedError";
  }
}

/** Путь от корня репозитория; «..», абсолютные пути, тесты (*.test.ts) и всё вне списка — нельзя. */
export function isAllowedPatchPath(p: string): boolean {
  if (!p || p.includes("\\") || p.includes("\0") || p.startsWith("/") || p.split("/").some((s) => s === ".." || s === "." || s === "")) return false;
  if (/\.test\.ts$/.test(p)) return false;
  return ALLOWED_PATCH_PATHS.some((re) => re.test(p));
}

export function assertAllowedPatch(paths: readonly string[]): void {
  const bad = paths.filter((p) => !isAllowedPatchPath(p));
  if (bad.length) throw new PatchRefusedError(bad);
}

/**
 * Пути из `git status --porcelain=v1 -z`: «XY путь\0»; у переименования — ещё «\0старый путь» (тоже проверяем).
 * Без trim: ведущий пробел статуса « M» — часть формата (обрезка съедала первую букву пути — отказ #383 selftest).
 */
export function changedPaths(z: string): string[] {
  const parts = z.split("\0");
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i]!;
    if (rec.length < 4) continue;
    const xy = rec.slice(0, 2);
    out.push(rec.slice(3));
    if (/[RC]/.test(xy) && parts[i + 1]) out.push(parts[++i]!);
  }
  return out;
}

// ---------------- куда что ----------------

export const PROMPT_RULES_HEADER = "Правила из отзывов носителей (quality-propose — каждое проверено eval «до / после»):";
export const KZ_GLOSSARY_FILE = "content/packs/kz/glossary.ts";
export const KZ_GLOSSARY_MARKER = "  // quality-propose: новые термины из отзывов носителей — над этой строкой";
export const CHECK_FILE: Partial<Record<string, string>> = { kk: "eval/kk-check.ts", ko: "eval/kr-check.ts" };
export const CHECK_MARKER = "  // quality-propose: новые правила — над этой строкой";

export const promptFile = (to: string) => `prompts/translate.${to}.md`;
export const goldenFile = (pair: string) => `eval/golden/${pair}.jsonl`;
export const branchName = (pair: string, date: Date) => `quality/${pair}-${date.toISOString().slice(0, 10).replace(/-/g, "")}`;

const oneLine = (s: string, n = 400) => s.replace(/\s+/g, " ").replace(/^[-•*\s]+/, "").trim().slice(0, n);
const lc = (s: string) => s.toLowerCase().replace(/ё/g, "е");

/** Строка правила для промпта перевода по находке (пусто — словами не сформулировать → issue). */
export function promptRuleOf(f: Pick<QualityFinding, "component" | "fix" | "summary">): string {
  const x: FindingFix = f.fix;
  const ex = x.wrong && x.right && x.wrong !== x.right ? ` Пример: не «${oneLine(x.wrong, 120)}», а «${oneLine(x.right, 120)}».` : "";
  if (f.component === "glossary" || x.kind === "glossary") {
    if (!x.right) return "";
    const src = x.src ? `«${oneLine(x.src, 120)}» → ` : "";
    return oneLine(`Глоссарий: ${src}${oneLine(x.right, 120)}${x.wrong && x.wrong !== x.right ? ` (не «${oneLine(x.wrong, 120)}»)` : ""}.`);
  }
  if (f.component === "names" || x.kind === "name") {
    if (!x.right) return "";
    return oneLine(`Имя${x.src ? ` «${oneLine(x.src, 120)}»` : ""} пишется «${oneLine(x.right, 120)}»${x.wrong && x.wrong !== x.right ? `, не «${oneLine(x.wrong, 120)}»` : ""} — везде одинаково.`);
  }
  if (x.rule) return oneLine(x.right && x.rule.includes(x.right) ? x.rule : `${x.rule}${ex}`);
  if (x.wrong && x.right && x.wrong !== x.right) return oneLine(`Пишите «${oneLine(x.right, 120)}», а не «${oneLine(x.wrong, 120)}».`);
  return "";
}

/** Добавить правила в промпт: раздел PROMPT_RULES_HEADER перед строкой «title …» (или «Ответ — только JSON»). */
export function addPromptRules(md: string, rules: readonly string[]): { text: string; added: string[] } {
  const have = lc(md);
  const added = [...new Set(rules.map((r) => oneLine(r)).filter(Boolean))].filter((r) => !have.includes(lc(r)));
  if (!added.length) return { text: md, added };
  const lines = md.split("\n");
  const bullets = added.map((r) => `- ${r}`);
  const h = lines.indexOf(PROMPT_RULES_HEADER);
  if (h >= 0) {
    let end = h + 1;
    while (end < lines.length && lines[end]!.startsWith("- ")) end++;
    lines.splice(end, 0, ...bullets);
    return { text: lines.join("\n"), added };
  }
  let at = lines.findIndex((l) => /^title(_ko)? —/.test(l));
  if (at < 0) at = lines.findIndex((l) => /^Ответ — только JSON/.test(l));
  if (at < 0) at = lines.length;
  lines.splice(at, 0, PROMPT_RULES_HEADER, ...bullets, "");
  return { text: lines.join("\n"), added };
}

const KINSHIP_RU = /(мам|пап|мат|отец|отц|бабуш|дед|брат|сестр|тёт|тет|дяд|внук|внуч|невест|сноха|зять|жена|муж|сын|доч|апа|свекр|тест|золов)/;

/** Термин в KZ_GLOSSARY (перед маркером). Уже есть такое казахское слово — не добавляем (только строка промпта). */
export function addKzTerm(ts: string, f: Pick<QualityFinding, "id" | "fix" | "summary">): { text: string; added: boolean } {
  const kk = oneLine(f.fix.right, 80);
  const ru = lc(oneLine(f.fix.src, 80));
  if (!kk || !ru || !ts.includes(KZ_GLOSSARY_MARKER)) return { text: ts, added: false };
  if (ts.includes(`kk: ${JSON.stringify(kk)}`)) return { text: ts, added: false };
  const section = KINSHIP_RU.test(ru) ? "kinship" : "life";
  const meaning = oneLine(f.summary, 160);
  const line = `  { kk: ${JSON.stringify(kk)}, ru: [${JSON.stringify(ru)}], meaning: ${JSON.stringify(meaning)}, section: "${section}", unsure: true }, // отзыв носителя, находка ${f.id.slice(0, 8)}`;
  return { text: ts.replace(KZ_GLOSSARY_MARKER, `${line}\n${KZ_GLOSSARY_MARKER}`), added: true };
}

/** Правило проверки «неверно → верно» в REVIEW_RULES_KK / REVIEW_RULES_KO (перед маркером). */
export function addCheckRule(ts: string, f: Pick<QualityFinding, "id" | "fix" | "summary">): { text: string; added: boolean } {
  const wrong = oneLine(f.fix.wrong, 80);
  const right = oneLine(f.fix.right, 80);
  if (!wrong || wrong === right || !ts.includes(CHECK_MARKER)) return { text: ts, added: false };
  if (ts.includes(`wrong: ${JSON.stringify(wrong)}`)) return { text: ts, added: false };
  const note = oneLine(f.fix.rule || f.summary, 160);
  const line = `  { wrong: ${JSON.stringify(wrong)}, right: ${JSON.stringify(right)}, note: ${JSON.stringify(note)}, finding: ${JSON.stringify(f.id.slice(0, 8))} },`;
  return { text: ts.replace(CHECK_MARKER, `${line}\n${CHECK_MARKER}`), added: true };
}

/** Правки абзацев из доказательств находок → строки золотого набора (eval/golden/<пара>.jsonl). */
export function goldenFromFindings(pair: string, findings: readonly Pick<QualityFinding, "evidence">[]): GoldenEntry[] {
  const out = new Map<string, GoldenEntry>();
  for (const f of findings)
    for (const e of f.evidence) {
      if (e.kind !== "edit" || !e.source || !e.before || !e.after || e.before.trim() === e.after.trim()) continue;
      const key = goldenKey(pair, e.source, e.before);
      out.set(key, {
        key,
        pair,
        kind: "chapter",
        persona: e.persona ?? "bank",
        title: e.title ?? null,
        source: e.source,
        model: e.before,
        gold: e.after,
        prompt_version: e.prompt_version ?? null,
        reviewer: e.reviewer,
        reviewed_at: e.reviewed_at,
      });
    }
  return [...out.values()];
}

// ---------------- предложение целиком ----------------

export interface ProposalChange {
  finding_id: string;
  component: FindingComponent;
  file: string;
  what: string;
}
export interface ProposalIssue {
  title: string;
  body: string;
  finding_ids: string[];
}
export interface ProposalPlan {
  pair: string;
  /** путь → новый текст (только изменённые файлы) */
  files: Record<string, string>;
  changes: ProposalChange[];
  issues: ProposalIssue[];
  goldenAdded: number;
  /** Находки, что вошли в предложение (патч, золотой набор или issue) */
  used: string[];
}

export function planProposal(opts: { pair: string; findings: readonly QualityFinding[]; read: (path: string) => string | null }): ProposalPlan {
  const { pair } = opts;
  const to = pair.split("-")[1] ?? "ko";
  const files: Record<string, string> = {};
  const get = (p: string) => files[p] ?? opts.read(p);
  const changes: ProposalChange[] = [];
  const route: QualityFinding[] = [];
  const unpatched: QualityFinding[] = [];
  const used = new Set<string>();
  const rules: { f: QualityFinding; rule: string }[] = [];

  for (const f of opts.findings) {
    if (f.pair !== pair) continue;
    if (f.component === "model_route") {
      route.push(f);
      used.add(f.id);
      continue;
    }
    if (f.component === "check_rule") {
      const file = CHECK_FILE[to];
      const cur = file ? get(file) : null;
      if (file && cur !== null) {
        const r = addCheckRule(cur, f);
        if (r.added) {
          files[file] = r.text;
          changes.push({ finding_id: f.id, component: f.component, file, what: `правило «${oneLine(f.fix.wrong, 60)}» → «${oneLine(f.fix.right, 60)}»` });
          used.add(f.id);
          continue;
        }
      }
      // нет файла проверки для языка или нет пары «неверно → верно» — правилом в промпт
    }
    if (f.component === "glossary" && to === "kk") {
      const cur = get(KZ_GLOSSARY_FILE);
      if (cur !== null) {
        const r = addKzTerm(cur, f);
        if (r.added) {
          files[KZ_GLOSSARY_FILE] = r.text;
          changes.push({ finding_id: f.id, component: f.component, file: KZ_GLOSSARY_FILE, what: `термин «${oneLine(f.fix.src, 60)}» → ${oneLine(f.fix.right, 60)}` });
        }
      }
    }
    const rule = promptRuleOf(f);
    if (rule) rules.push({ f, rule });
    else if (!changes.some((c) => c.finding_id === f.id)) unpatched.push(f);
  }

  if (rules.length) {
    const file = promptFile(to);
    const cur = get(file);
    if (cur !== null) {
      const r = addPromptRules(cur, rules.map((x) => x.rule));
      if (r.added.length) files[file] = r.text;
      const addedLc = new Set(r.added.map(lc));
      for (const { f, rule } of rules) {
        used.add(f.id);
        changes.push({ finding_id: f.id, component: f.component, file, what: addedLc.has(lc(oneLine(rule))) ? `правило: ${oneLine(rule, 140)}` : "правило уже есть в промпте" });
      }
    } else unpatched.push(...rules.map((x) => x.f));
  }

  // золотой набор — из всех правок абзацев этих находок
  const incoming = goldenFromFindings(pair, opts.findings.filter((f) => f.pair === pair));
  let goldenAdded = 0;
  if (incoming.length) {
    const file = goldenFile(pair);
    const cur = get(file) ?? "";
    const existing = parseGolden(cur);
    const merged = mergeGolden(existing, incoming);
    const text = renderGolden(merged);
    if (text !== cur) {
      files[file] = text;
      const keys = new Set(existing.map((e) => `${e.key}|${e.gold}`));
      goldenAdded = incoming.filter((e) => !keys.has(`${e.key}|${e.gold}`)).length;
      for (const f of opts.findings)
        if (f.pair === pair && f.evidence.some((e) => e.kind === "edit" && e.source)) {
          used.add(f.id);
          if (!changes.some((c) => c.finding_id === f.id)) changes.push({ finding_id: f.id, component: f.component, file, what: "правка носителя → золотой набор" });
        }
    }
  }

  const issues: ProposalIssue[] = [];
  if (route.length)
    issues.push({
      title: `[v2 Q] Маршрут модели ${pair}: ${route.length} ${plural(route.length, "находка", "находки", "находок")} из отзывов носителей`,
      body: issueBody(pair, route, "Маршруты моделей (`ai_routes`, `lib/ai/config.ts`) quality-propose не меняет — только предложение. Решить: другая модель / цепочка для шага translate этой пары, затем eval «до / после»."),
      finding_ids: route.map((f) => f.id),
    });
  const left = unpatched.filter((f) => !used.has(f.id));
  if (left.length) {
    for (const f of left) used.add(f.id);
    issues.push({
      title: `[v2 Q] ${pair}: ${left.length} ${plural(left.length, "находка", "находки", "находок")} без правки в разрешённых файлах`,
      body: issueBody(pair, left, "Словами в промпт / глоссарий / правило проверки это не сформулировалось (или нужна правка кода конвейера). Сформулировать правило руками или завести правку кода отдельной задачей."),
      finding_ids: left.map((f) => f.id),
    });
  }

  assertAllowedPatch(Object.keys(files));
  return { pair, files, changes, issues, goldenAdded, used: [...used] };
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

function exampleOf(f: QualityFinding): string {
  const e = f.evidence.find((x) => x.before || x.after);
  if (!e) return "";
  return `~~${cell(e.before.slice(0, 140))}~~ → **${cell(e.after.slice(0, 140))}**`;
}

function issueBody(pair: string, fs: readonly QualityFinding[], what: string): string {
  return [
    `Пара **${pair}** · из разбора отзывов проверяющих (quality-digest, #354). Только вымышленные тексты банка / eval.`,
    "",
    what,
    "",
    "| Находка | Важность | Текстов | Пример (было → правка носителя) |",
    "| --- | --- | --- | --- |",
    ...fs.map((f) => `| ${cell(f.summary)} | ${SEVERITY_RU[f.severity]} | ${f.count} | ${exampleOf(f)} |`),
    "",
    `Находки: ${fs.map((f) => `\`${f.id.slice(0, 8)}\``).join(", ")} — вкладка «Находки» /admin/quality/findings?pair=${pair} (staging).`,
  ].join("\n");
}

/** Описание PR quality/<пара>-<дата>: какие отзывы → что меняем; строка «Флаг:» для CI flag-line. */
export function proposalBody(opts: {
  plan: ProposalPlan;
  findings: readonly QualityFinding[];
  proposalId: string;
  issues: { number: number; title: string }[];
  runUrl?: string;
  tokenNote?: string;
}): string {
  const { plan } = opts;
  const fs = opts.findings.filter((f) => plan.used.includes(f.id));
  const byId = new Map(fs.map((f) => [f.id, f]));
  const reviewers = [...new Set(fs.flatMap((f) => f.evidence.map((e) => e.reviewer)).filter(Boolean))];
  const links = new Set(fs.flatMap((f) => f.link_ids));
  const rows = plan.changes.map((c) => {
    const f = byId.get(c.finding_id);
    return `| ${f ? cell(f.summary) : c.finding_id.slice(0, 8)} | ${COMPONENT_RU[c.component]} | ${f ? SEVERITY_RU[f.severity] : ""} | ${f?.count ?? 1} | \`${c.file}\` — ${cell(c.what)} |`;
  });
  const examples = fs
    .map((f) => ({ f, ex: exampleOf(f) }))
    .filter((x) => x.ex)
    .slice(0, 8)
    .map(({ f, ex }) => `- ${cell(f.summary)}: ${ex}`);
  const rukr = plan.pair === "ru-ko";
  return [
    `Предложение правки по отзывам проверяющих — пара **${plan.pair}** (quality-propose, #354, эпик #351).`,
    "",
    `Отзывов: ${fs.reduce((s, f) => s + f.feedback_ids.length, 0)} в ${links.size} ${plural(links.size, "ссылке", "ссылках", "ссылках")}` +
      `${reviewers.length ? ` (проверяющие: ${reviewers.join(", ")})` : ""} → находок: ${fs.length}. Только вымышленные тексты банка / eval / демо.`,
    "",
    "## Какие отзывы → что меняем",
    "| Находка | Компонент | Важность | Текстов | Что меняем |",
    "| --- | --- | --- | --- | --- |",
    ...(rows.length ? rows : ["| — | | | | патча нет, только issues |"]),
    "",
    ...(examples.length ? ["## Примеры «было → правка носителя»", ...examples, ""] : []),
    ...(plan.goldenAdded ? [`Золотой набор \`eval/golden/${plan.pair}.jsonl\`: +${plan.goldenAdded} ${plural(plan.goldenAdded, "абзац", "абзаца", "абзацев")} (правки носителя — эталон для eval «Носители»).`, ""] : []),
    ...(opts.issues.length ? ["## Не патчем — issues", ...opts.issues.map((i) => `- #${i.number} ${i.title}`), ""] : []),
    "## Как проверить",
    "- eval на этом PR: «до / после» по паре + строка «Носители» (золотой набор) — без 🔴 и без ухудшений.",
    ...(rukr ? ["- ⚠️ **RU + KR:** не сливать без eval «до / после» без ухудшений (Q4 #355, правило волн качества)."] : []),
    "- Слияние — только через «Одобрить» во вкладке «Изменения» (Q4 #355) или человеком. quality-propose сам ничего не сливает.",
    "",
    `Предложение: \`quality_proposals.${opts.proposalId}\` (staging)${opts.runUrl ? ` · запуск: ${opts.runUrl}` : ""}`,
    ...(opts.tokenNote ? ["", opts.tokenNote] : []),
    "",
    "Флаг: не нужен — правка промпта / глоссария через eval",
  ].join("\n");
}
