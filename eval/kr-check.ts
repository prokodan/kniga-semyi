// Проверка корейского (V2): демо-главы книги и банк вопросов.
//   1) правила без ИИ — глоссарий docs/glossary.md (корё мар, реалии, топонимы, фамилии, «не:» варианты), годы,
//      пояснения в скобках, которых нет в оригинале,
//      стиль речи (한다체 в повествовании, 해요체 + почтительное -시- в вопросах), кириллица, цитата;
//   2) обратный перевод KR→RU ДРУГИМ провайдером, чем переводил (translate идёт на Gemini → проверяет OpenAI;
//      нет ключа OpenAI — Gemini Flash, т. е. другая модель), сверка с RU, флажки (промпт eval/back_translate.md).
// Итог: короткий список флажков по 1–2 самым сомнительным демо-главам — для человека; остальное — в отчёте.
// Запуск: npx tsx scripts/kr-check.ts (без ключей — только правила и mock, бесплатно).
import type { AiRouter } from "@/lib/ai/router";

export type GlossarySection = "koryo" | "realia" | "place" | "surname";

export interface GlossaryEntry {
  section: GlossarySection;
  ru: string[];
  ko: string[];
  note: string;
  confirmed: boolean;
  /** «не: 아버님 / 아빠» в колонке «Пояснение» — варианты, которых в главе быть не должно */
  avoid: string[];
  /** Допустимые пояснения в скобках: 한식(寒食), 콜호스(집단농장) — из колонок «한국어» и «Пояснение» */
  glosses: string[];
}

export interface KrItem {
  id: string;
  kind: "chapter" | "question";
  /** Подпись для человека: «Глава 2 «Кукси у печки»» */
  label: string;
  block?: string;
  text_ru: string;
  text_ko: string;
  quote_ko?: string;
}

export type Severity = "minor" | "major";

export interface KrFlag {
  id: string;
  source: "rule" | "ai";
  rule: string;
  ko: string;
  ru?: string;
  back_ru?: string;
  issue: string;
  severity: Severity;
}

// ── Глоссарий ────────────────────────────────────────────────────────────────

const SECTION_BY_HEADING: [RegExp, GlossarySection][] = [
  [/корё мар/i, "koryo"],
  [/реали/i, "realia"],
  [/топоним/i, "place"],
  [/фамили/i, "surname"],
];

const splitVariants = (cell: string) =>
  cell
    .split(" / ")
    .map((s) => s.trim())
    .filter(Boolean);

/** Таблицы docs/glossary.md → записи. Строки без русского или корейского пропускаются. */
export function parseGlossary(md: string): GlossaryEntry[] {
  const out: GlossaryEntry[] = [];
  let section: GlossarySection | null = null;
  for (const line of md.split("\n")) {
    const h = /^##\s+(.+)/.exec(line);
    if (h) {
      section = SECTION_BY_HEADING.find(([re]) => re.test(h[1]!))?.[1] ?? null;
      continue;
    }
    if (!section || !line.startsWith("|")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 2 || cells[0] === "RU" || /^-+$/.test(cells[0]!)) continue;
    const ru = splitVariants(cells[0]!);
    const koRaw = splitVariants(cells[1]!);
    const ko = koRaw.map((v) => v.replace(/\(.*?\)/g, "").trim()).filter(Boolean);
    if (!ru.length || !ko.length) continue;
    const note = cells[2] ?? "";
    const avoid = /не:\s*([^;]+)/.exec(note)?.[1];
    const glosses = [...koRaw, note].flatMap((t) => [...t.matchAll(/[가-힣]+\([^)]+\)/g)].map((m) => m[0]));
    out.push({
      section,
      ru,
      ko,
      note,
      confirmed: (cells[3] ?? "").includes("✓"),
      avoid: avoid ? splitVariants(avoid).filter((v) => /[가-힣]/.test(v)) : [],
      glosses,
    });
  }
  return out;
}

const yo = (s: string) => s.replace(/ё/g, "е").replace(/Ё/g, "Е");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const RU_LETTER = "А-Яа-яЁё";

/** Регулярка варианта: `колхоз*` — начало слова, иначе слово целиком. */
export function variantRegex(variant: string, caseSensitive: boolean): RegExp {
  const v = yo(variant);
  const star = v.endsWith("*");
  const body = escape(star ? v.slice(0, -1) : v);
  const tail = star ? `[${RU_LETTER}]*` : `(?![${RU_LETTER}])`;
  return new RegExp(`(?<![${RU_LETTER}-])${body}${tail}`, caseSensitive ? "u" : "iu");
}

const compact = (s: string) => s.replace(/\s+/g, "");

function glossaryFlags(item: KrItem, glossary: GlossaryEntry[]): KrFlag[] {
  const flags: KrFlag[] = [];
  const ru = yo(item.text_ru);
  const ko = compact(item.text_ko);
  for (const e of glossary) {
    const cs = e.section === "place" || e.section === "surname";
    const hit = e.ru.map((v) => variantRegex(v, cs).exec(ru)).find(Boolean);
    if (!hit) continue;
    const bad = e.avoid.find((a) => ko.includes(compact(a)));
    if (bad) {
      flags.push({
        id: item.id,
        source: "rule",
        rule: "glossary:variant",
        ko: bad,
        ru: hit[0],
        issue: `«${hit[0]}» → ${e.ko.join(" / ")}, не ${bad} (глоссарий)`,
        severity: "minor",
      });
    }
    if (!e.ko.some((k) => ko.includes(compact(k)))) {
      flags.push({
        id: item.id,
        source: "rule",
        rule: `glossary:${e.section}`,
        ko: "",
        ru: hit[0],
        issue: `«${hit[0]}» — в корейском нет ${e.ko.join(" / ")} (глоссарий)`,
        severity: cs ? "major" : "minor",
      });
      continue;
    }
    // «при первом упоминании 콜호스(집단농장)» — в этом тексте первое вхождение с пояснением в скобках
    const first = /первом упоминании\s+([가-힣]+)\(/.exec(e.note);
    if (first) {
      const word = first[1]!;
      const at = item.text_ko.indexOf(word);
      if (at >= 0 && !item.text_ko.slice(at + word.length).trimStart().startsWith("(")) {
        flags.push({
          id: item.id,
          source: "rule",
          rule: "glossary:first-mention",
          ko: word,
          ru: hit[0],
          issue: `при первом упоминании — с пояснением: ${e.note.replace(/^.*первом упоминании\s+/, "")}`,
          severity: "minor",
        });
      }
    }
  }
  return flags;
}

// ── Пояснения в скобках ─────────────────────────────────────────────────────

/** Скобки в корейском, которых нет в оригинале: 아파디 우리(아버지의 집), 아지바이(아버지).
 *  Допустимо: пояснение из глоссария (콜호스(집단농장)), ханча (한식(寒食)) и столько скобок, сколько их в русском. */
export function parenFlags(item: KrItem, glossary: GlossaryEntry[]): KrFlag[] {
  const allowed = new Set(glossary.flatMap((g) => g.glosses.map(compact)));
  const ruParens = (item.text_ru.match(/\([^)]*\)/g) ?? []).length;
  const extra: string[] = [];
  for (const m of item.text_ko.matchAll(/([가-힣A-Za-z0-9]*)\s*\(([^)]*)\)/g)) {
    const word = compact(`${m[1]}(${m[2]})`);
    if (/^[\u4e00-\u9fff]+$/.test(m[2]!.trim())) continue; // ханча после слова — 한식(寒食), не пояснение
    if ([...allowed].some((a) => word.endsWith(a))) continue;
    extra.push(m[0].trim());
  }
  return extra.slice(ruParens).map((ko) => ({
    id: item.id,
    source: "rule" as const,
    rule: "paren",
    ko,
    issue: "пояснение в скобках, которого нет в оригинале — убрать (перевод не объясняет, а передаёт)",
    severity: "major" as const,
  }));
}

// ── Годы ─────────────────────────────────────────────────────────────────────

const TENS: [RegExp, number][] = [
  [/^двадцат/, 20],
  [/^тридцат/, 30],
  [/^сорок/, 40],
  [/^пятидесят|^пятьдесят/, 50],
  [/^шестидесят|^шестьдесят/, 60],
  [/^семидесят|^семьдесят/, 70],
  [/^восьмидесят|^восемьдесят/, 80],
  [/^девяност/, 90],
];
const UNITS: [RegExp, number][] = [
  [/^перв/, 1],
  [/^втор/, 2],
  [/^трет/, 3],
  [/^четв[её]рт/, 4],
  [/^пят[оыа]/, 5],
  [/^шест[оыа]/, 6],
  [/^седьм/, 7],
  [/^восьм/, 8],
  [/^девят[оыа]/, 9],
];
const ORDINAL_END = /(ом|ого|ой|ый|ая|ую|ые|ых|ем|его|ей|ий|ья|ью|ьи)$/;

/** Годы в русском тексте: цифрами и словами («в тридцать седьмом», «в сороковом году») → 19XX. */
export function yearsRu(text: string): Set<number> {
  const years = new Set<number>();
  for (const m of text.matchAll(/(?<!\d)(1[89]\d\d|20[0-4]\d)(?!\d)/g)) years.add(Number(m[1]));
  const words = text.toLowerCase().split(/[^а-яё]+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const tens = TENS.find(([re]) => re.test(w));
    if (!tens) continue;
    const next = words[i + 1] ?? "";
    const unit = UNITS.find(([re]) => re.test(next));
    if (!ORDINAL_END.test(w)) {
      if (unit && ORDINAL_END.test(next)) years.add(1900 + tens[1] + unit[1]); // «тридцать седьмом»
    } else years.add(1900 + tens[1]); // «в сороковом», «в шестидесятые»
  }
  return years;
}

export const yearsKo = (text: string) => new Set([...text.matchAll(/(\d{4})\s*년/g)].map((m) => Number(m[1])));

function yearFlags(item: KrItem): KrFlag[] {
  const ru = yearsRu(item.text_ru);
  const ko = yearsKo(item.text_ko);
  const flags: KrFlag[] = [];
  for (const y of ru)
    if (!ko.has(y)) flags.push({ id: item.id, source: "rule", rule: "year", ko: "", ru: String(y), issue: `год ${y} есть в оригинале, в корейском нет ${y}년`, severity: "major" });
  for (const y of ko)
    if (!ru.has(y)) flags.push({ id: item.id, source: "rule", rule: "year", ko: `${y}년`, issue: `год ${y} в корейском, в оригинале его нет`, severity: "major" });
  return flags;
}

// ── Стиль речи ───────────────────────────────────────────────────────────────

/** Прямая речь в кавычках не участвует в проверке стиля повествования. */
const withoutQuotes = (s: string) => s.replace(/"[^"]*"|“[^”]*”|«[^»]*»|'[^']*'/g, " ");

export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => /[가-힣]/.test(s));
}

const ELDER = /(아버지|어머니|부모님|할머니|할아버지|선생님|어른들)(께서|는|은|이|가)/;
/** Почтительное -시- в сказуемом (грубо, без морфологии): 하셨다, 하시던, 계신, 주셨다… */
export const HONORIFIC = /(셨|셔|십니|세요|계시|계신|[가-힣]시[고며면던는다지게어었]|[가-힣]신(?=[\s?.,!]|$))/;
/** …습니다 / …합니다: слог перед 니다 с patchim ㅂ (아니다 — не 합쇼체). */
export function isHapsyo(e: string): boolean {
  if (!e.endsWith("니다") || e.length < 3) return false;
  const c = e.charCodeAt(e.length - 3) - 0xac00;
  return e.endsWith("습니다") || (c >= 0 && c < 11172 && c % 28 === 17);
}
const end = (s: string) => s.replace(/["'”»)\s.!?…]+$/, "");

/** Абзацы корейского текста: пустая строка или перевод строки. */
export const paragraphs = (text: string) => text.split(/\n+/).map((p) => p.trim()).filter((p) => /[가-힣]/.test(p));

function styleFlagsChapter(item: KrItem): KrFlag[] {
  const flags: KrFlag[] = [];
  // Смешение 해요체 и 한다체 — внутри одного абзаца (прямая речь в кавычках не считается)
  paragraphs(withoutQuotes(item.text_ko)).forEach((p, i) => {
    const ends = sentences(p).map(end);
    const yo = sentences(p).filter((_, k) => /요$/.test(ends[k]!));
    if (yo.length && ends.some((e) => /다$/.test(e) && !isHapsyo(e)))
      flags.push({ id: item.id, source: "rule", rule: "style:mixed", ko: yo[0]!.slice(-30), issue: `смешение 해요체 и 한다체 в абзаце ${i + 1} — один стиль повествования`, severity: "minor" });
  });
  for (const s of sentences(withoutQuotes(item.text_ko))) {
    const e = end(s);
    if (isHapsyo(e)) flags.push({ id: item.id, source: "rule", rule: "style:hapsyo", ko: s.slice(-30), issue: "습니다체 в повествовании — нужен 한다체 (했다, 살았다)", severity: "minor" });
    const m = ELDER.exec(s);
    if (m && !HONORIFIC.test(s.slice(m.index + m[0].length))) {
      flags.push({ id: item.id, source: "rule", rule: "style:honorific", ko: s.slice(m.index, m.index + 40), issue: `о старшем (${m[1]}) без почтительного -시- — проверить сказуемое`, severity: "minor" });
    }
    if (/그녀/.test(s))
      flags.push({ id: item.id, source: "rule", rule: "style:geunyeo", ko: s.slice(Math.max(0, s.indexOf("그녀") - 10), s.indexOf("그녀") + 20), issue: "그녀 — книжно для рассказа о близком; лучше по роли (할머니, 그 사람)", severity: "minor" });
  }
  return flags;
}

/** Вопросы: одна строка text_ko = один вопрос (банк сгруппирован по блокам). */
function styleFlagsQuestion(item: KrItem): KrFlag[] {
  const flags: KrFlag[] = [];
  for (const q of item.text_ko.split("\n").map((l) => l.trim()).filter(Boolean)) {
    for (const s of sentences(q)) {
      const e = end(s);
      if (!/(요|까)$/.test(e) && !/[:：]$/.test(s))
        flags.push({ id: item.id, source: "rule", rule: "style:haeyo", ko: s, issue: "вопрос не в 해요체 (…세요? / …셨어요?)", severity: "minor" });
    }
    if (!HONORIFIC.test(q) && !/(님|분|께)/.test(q))
      flags.push({ id: item.id, source: "rule", rule: "style:honorific", ko: q, issue: "к собеседнику 70–90 лет без почтительного -시-", severity: "minor" });
    if (/무엇이에요/.test(q))
      flags.push({ id: item.id, source: "rule", rule: "style:natural", ko: q, issue: "무엇이에요? звучит как перевод — естественнее 무엇인가요?", severity: "minor" });
  }
  return flags;
}

/** Все правила без ИИ для одного текста. */
export function checkItem(item: KrItem, glossary: GlossaryEntry[]): KrFlag[] {
  const flags: KrFlag[] = [];
  const cyr = /[А-Яа-яЁё]+/.exec(item.text_ko);
  if (cyr) flags.push({ id: item.id, source: "rule", rule: "cyrillic", ko: cyr[0], issue: "кириллица внутри корейского текста", severity: "major" });
  if (item.quote_ko && !compact(item.text_ko).includes(compact(item.quote_ko)))
    flags.push({ id: item.id, source: "rule", rule: "quote", ko: item.quote_ko.slice(0, 40), issue: "цитата quote_ko не совпадает с фразой в тексте", severity: "major" });
  flags.push(...glossaryFlags(item, glossary), ...yearFlags(item));
  if (item.kind === "chapter") flags.push(...parenFlags(item, glossary));
  flags.push(...(item.kind === "chapter" ? styleFlagsChapter(item) : styleFlagsQuestion(item)));
  return flags;
}

// ── Обратный перевод другим провайдером ─────────────────────────────────────

export type BackMode = "openai" | "gemini" | "mock";

/** Перевод в проде идёт на Gemini — значит, проверяет OpenAI; нет ключа — Gemini Flash (другая модель). */
export function chooseBackMode(env: Record<string, string | undefined>): BackMode {
  const forced = env.KR_CHECK_PROVIDER?.trim();
  if (forced === "openai" || forced === "gemini" || forced === "mock") return forced;
  if (env.OPENAI_API_KEY?.trim()) return "openai";
  if (env.GEMINI_API_KEY?.trim()) return "gemini";
  return "mock";
}

export interface BackResult {
  flags: KrFlag[];
  meaning: Record<string, number>;
  back: Record<string, string>;
  provider: string;
  model: string;
  error?: string;
}

export async function backTranslate(ai: Pick<AiRouter, "runWithMeta">, items: KrItem[]): Promise<BackResult> {
  const res = await ai.runWithMeta("back_translate", {
    chapters: items.slice(0, 20).map((i) => ({ id: i.id, text_ru: i.text_ru, text_ko: i.text_ko, quote_ko: i.quote_ko ?? "" })),
  });
  const flags: KrFlag[] = [];
  const meaning: Record<string, number> = {};
  const back: Record<string, string> = {};
  const known = new Set(items.map((i) => i.id));
  for (const c of res.output.chapters) {
    if (!known.has(c.id)) continue;
    meaning[c.id] = c.meaning;
    back[c.id] = c.back_ru;
    for (const f of c.flags)
      flags.push({ id: c.id, source: "ai", rule: "back_translate", ko: f.ko, back_ru: f.back_ru, ru: f.ru, issue: f.issue, severity: f.severity });
    if (c.meaning <= 3 && !c.flags.some((f) => f.severity === "major"))
      flags.push({ id: c.id, source: "ai", rule: "meaning", ko: "", back_ru: c.back_ru.slice(0, 120), issue: `смысл расходится с оригиналом (${c.meaning} из 5)`, severity: "major" });
  }
  return { flags, meaning, back, provider: res.provider, model: res.model };
}

// ── Итог для человека ───────────────────────────────────────────────────────

const weight = (f: KrFlag) => (f.severity === "major" ? 3 : 1);

/** Убирает дубли: правило и ИИ нашли одно и то же место. */
export function dedupe(flags: KrFlag[]): KrFlag[] {
  const seen = new Set<string>();
  return flags.filter((f) => {
    const key = `${f.id}|${compact(f.ko).slice(0, 12) || f.rule + (f.ru ?? "")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 1–2 демо-главы с самыми весомыми флажками, в каждой — до maxPer флажков (сначала major). */
export function pickForHuman(items: KrItem[], flags: KrFlag[], chapters = 2, maxPer = 4) {
  const byId = new Map<string, KrFlag[]>();
  for (const f of dedupe(flags)) byId.set(f.id, [...(byId.get(f.id) ?? []), f]);
  return items
    .filter((i) => i.kind === "chapter" && byId.has(i.id))
    .map((i) => ({ item: i, flags: byId.get(i.id)!.sort((a, b) => weight(b) - weight(a)), score: byId.get(i.id)!.reduce((s, f) => s + weight(f), 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, chapters)
    .map((x) => ({ ...x, flags: x.flags.slice(0, maxPer) }));
}

export interface KrReport {
  date: string;
  mode: BackMode;
  provider: string;
  model: string;
  aiError?: string;
  items: KrItem[];
  flags: KrFlag[];
  meaning: Record<string, number>;
  glossary: { total: number; confirmed: number };
}

const icon = (s: Severity) => (s === "major" ? "🔴" : "🟡");
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

function humanLines(r: KrReport): string[] {
  const picked = pickForHuman(r.items, r.flags);
  if (!picked.length) return ["Флажков по демо-главам нет — человеку проверять нечего."];
  const lines: string[] = [];
  for (const p of picked) {
    lines.push(`**${p.item.label}**`);
    for (const f of p.flags) {
      const ko = f.ko ? `«${f.ko}» — ` : "";
      const ru = f.ru ? ` (в оригинале: «${f.ru}»)` : "";
      lines.push(`- [ ] ${icon(f.severity)} ${ko}${f.issue}${ru}`);
    }
    lines.push("");
  }
  lines.push("Отметьте: ок как есть / поправить (как).");
  return lines;
}

export function renderKrReport(r: KrReport, opts: { link?: string; marker?: boolean } = {}): string {
  const real = r.mode !== "mock" && !r.aiError;
  const flags = dedupe(r.flags);
  const majors = flags.filter((f) => f.severity === "major").length;
  const out: string[] = [];
  if (opts.marker) out.push("<!-- kniga-kr -->");
  out.push(`## 🇰🇷 Проверка корейского — ${r.date}`, "");
  out.push(
    `Обратный перевод KR→RU: ${real ? `**${r.provider} / ${r.model}**` : r.aiError ? `🔴 не удался (${r.aiError}) — только правила` : "**mock** — ключей нет, только правила (не показательно)"}` +
      ` · правила: глоссарий (${r.glossary.total} записей, подтверждено носителем ${r.glossary.confirmed}), годы, стиль речи, кириллица, цитата`,
    "",
  );
  out.push(`Флажков: **${flags.length}** (🔴 ${majors} · 🟡 ${flags.length - majors}).`, "");
  out.push("### Человеку: проверить", "", ...humanLines(r), "");
  out.push("### По текстам", "", "| Текст | Смысл 1–5 | 🔴 | 🟡 |", "| --- | --- | --- | --- |");
  for (const i of r.items) {
    const f = flags.filter((x) => x.id === i.id);
    const maj = f.filter((x) => x.severity === "major").length;
    out.push(`| ${cell(i.label)} | ${r.meaning[i.id] ?? "—"} | ${maj || ""} | ${f.length - maj || ""} |`);
  }
  out.push("", "<details><summary>Все флажки</summary>", "");
  if (!flags.length) out.push("Нет.");
  for (const i of r.items) {
    const f = flags.filter((x) => x.id === i.id);
    if (!f.length) continue;
    out.push(`**${i.label}**`);
    for (const x of f) {
      const extra = [x.ru && `RU: «${x.ru}»`, x.back_ru && `обратно: «${x.back_ru}»`].filter(Boolean).join(" · ");
      out.push(`- ${icon(x.severity)} \`${x.source === "ai" ? "ИИ" : x.rule}\` ${x.ko ? `«${x.ko}» — ` : ""}${x.issue}${extra ? ` (${extra})` : ""}`);
    }
    out.push("");
  }
  out.push("</details>", "");
  if (opts.link) out.push(`[Запуск](${opts.link}) · глоссарий — \`docs/glossary.md\``);
  return out.join("\n");
}
