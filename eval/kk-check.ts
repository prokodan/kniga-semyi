// Проверка казахского перевода (#231, как kr-check для корейского). Носителя пока нет — это эвристики и обратный
// перевод, а не оценка качества языка: «ничего не нашлось» ≠ «перевод хороший» (проверка носителем — #232).
//   1) правила без ИИ: казахские буквы есть; нет русских служебных слов и русского родства; родство и реалии —
//      по глоссарию пакета kz («не:» варианты); «сен» к старшим — флажок; годы цифрами как в оригинале; имена
//      из оригинала на месте; латиница / хангыль; цитата есть в тексте; #298: латиница любой длины, обращение к внукам
//      вперемешку («сендер» и «сіздер» в одном абзаце) — флажки `latin`, `style:grandkids`;
//   2) обратный перевод kk → ru ДРУГИМ провайдером (translate.ru.md; как в kr-check: OpenAI, нет ключа — другая
//      модель Gemini) — сверка годов и «ключевых фактов» персонажа (eval/sim/facts.ts) с обратным текстом.
import type { AiRouter } from "@/lib/ai/router";
import { translateInput } from "@/lib/ai/types";
import { KZ_GLOSSARY, type KzTerm } from "@/content/packs/kz/glossary";
import { grandkidsMixedKk, kkScriptLeft } from "@/lib/pipeline/kk";
import { yearsRu } from "./kr-check";

export type KkSeverity = "minor" | "major";

export interface KkFlag {
  id: string;
  rule: string;
  kk: string;
  issue: string;
  severity: KkSeverity;
}

export interface KkItem {
  id: string;
  label: string;
  /** Русский оригинал (или, для kk-оригинала, русский перевод — тогда сверяем в обратную сторону) */
  text_ru: string;
  text_kk: string;
  title_kk?: string;
  quote_kk?: string;
  /** Имена людей и мест из оригинала (словарь семьи / факты главы) — должны быть в kk */
  names?: string[];
}

/** Буквы, которых нет в русском алфавите: без них это не казахский текст. */
export const KK_LETTERS = /[әіңғүұқөһӘІҢҒҮҰҚӨҺ]/;

/**
 * Русские слова, которых не бывает в казахском тексте. Осторожно: «не» (= что), «он» (= десять), «а», «да», «сол»,
 * «бар», «мен» — казахские слова, их в списке нет.
 */
const RUSSIAN_WORDS = new Set([
  "и", "в", "во", "на", "что", "чтобы", "как", "был", "была", "было", "были", "это", "этот", "эта", "они", "она", "оно",
  "мы", "вы", "но", "или", "когда", "потом", "тоже", "очень", "только", "же", "бы", "по", "из", "для", "от", "со", "к",
  "у", "его", "её", "ее", "мне", "меня", "нас", "нам", "их", "так", "там", "где", "уже", "ещё", "еще", "всё", "все",
  "мама", "папа", "бабушка", "дедушка", "дядя", "тётя", "тетя", "брат", "сестра", "внук", "внучка", "внуки", "сын", "дочь",
  "школа", "школу", "школе", "война", "войну", "год", "году", "года", "лет",
]);

/** «Сен» и его формы — к старшим недопустимо (к внукам можно — поэтому флажок, а не ошибка). */
const SEN = /(^|[^\p{L}])(сен|сені|саған|сенің|сенде|сенен|сенімен)(?=[^\p{L}]|$)/iu;

const words = (s: string) => s.toLowerCase().match(/[\p{L}]+/gu) ?? [];
const kkYears = (s: string) => new Set([...s.matchAll(/(?<!\d)(1[89]\d{2}|20\d{2})(?!\d)/g)].map((m) => Number(m[1])));

function excerpt(text: string, word: string): string {
  const i = text.toLowerCase().indexOf(word.toLowerCase());
  if (i < 0) return word;
  return text.slice(Math.max(0, i - 25), i + word.length + 25).replace(/\s+/g, " ").trim();
}

/** Неверный вариант из глоссария («не:») — целым словом с любым окончанием. */
function variantRe(v: string): RegExp {
  return new RegExp(`(^|[^\\p{L}])${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "iu");
}

/** Правила без ИИ для одной главы. */
export function checkKk(item: KkItem, glossary: readonly KzTerm[] = KZ_GLOSSARY): KkFlag[] {
  const flags: KkFlag[] = [];
  const add = (rule: string, kk: string, issue: string, severity: KkSeverity) => flags.push({ id: item.id, rule, kk, issue, severity });
  const all = [item.title_kk ?? "", item.text_kk, item.quote_kk ?? ""].join("\n");
  if (!item.text_kk.trim()) {
    add("empty", "", "казахского текста нет", "major");
    return flags;
  }

  if (!KK_LETTERS.test(item.text_kk)) add("letters", item.text_kk.slice(0, 60), "нет ни одной казахской буквы (әіңғүұқөһ) — это не казахский текст", "major");

  const ru = [...new Set(words(all).filter((w) => RUSSIAN_WORDS.has(w)))];
  // одно-два служебных слова — флажок; много — текст остался русским
  if (ru.length >= 6) add("russian", ru.slice(0, 8).join(", "), `много русских слов (${ru.length}) — перевод частично не сделан`, "major");
  else for (const w of ru) add("russian", excerpt(all, w), `русское слово «${w}» в казахском тексте`, "minor");

  for (const t of glossary)
    for (const v of t.not ?? []) if (variantRe(v).test(all)) add("glossary:variant", excerpt(all, v), `«${v}» → по глоссарию «${t.kk}» (${t.meaning})`, "minor");

  if (SEN.test(all)) add("style:sen", excerpt(all, all.match(SEN)![2]!), "«сен» — к старшим только «Сіз» (к внукам можно — проверьте, к кому)", "minor");

  const ruYears = yearsRu(item.text_ru);
  const kYears = kkYears(all);
  for (const y of ruYears) if (!kYears.has(y)) add("years", String(y), `год ${y} из оригинала не написан цифрами в переводе`, "major");
  for (const y of kYears) if (!ruYears.has(y) && !years(item.text_ru).includes(y)) add("years", String(y), `год ${y} — его нет в оригинале`, "major");

  for (const name of item.names ?? []) {
    const stem = name.trim().slice(0, Math.max(3, Math.min(5, name.trim().length - 1))).toLowerCase();
    if (stem.length >= 3 && !all.toLowerCase().includes(stem) && !kkSpelling(name, glossary, all)) add("names", name, `«${name}» из оригинала не видно в переводе`, "minor");
  }

  // #298: любое слово с латиницей (и «da» из двух букв, и смешанное «кеlді»), кроме слов оригинала; конвейер такое
  // исправляет сам (lib/pipeline/kk.ts) — здесь остаётся только то, что он не смог
  for (const w of kkScriptLeft(all, item.text_ru).latin) add("latin", excerpt(all, w), `латиница в казахском тексте: «${w}»`, "minor");
  // #298: к внукам — одно обращение на главу («сендер»), без «сіздер» в том же абзаце (как 해라체 #154 для ko)
  for (const m of grandkidsMixedKk(item.text_kk))
    add("style:grandkids", excerpt(item.text_kk, m.polite), `абз. ${m.paragraph}: к внукам и «${m.familiar}», и «${m.polite}» — одно обращение (сендер)`, "minor");
  if (/[가-힣]/.test(all)) add("hangul", "", "хангыль в казахском тексте", "major");

  if (item.quote_kk?.trim() && !item.text_kk.replace(/\s+/g, " ").includes(item.quote_kk.replace(/\s+/g, " ").trim().replace(/[.!?…]+$/, "")))
    add("quote", item.quote_kk.slice(0, 80), "цитата не совпадает с фразой в тексте", "minor");
  return flags;
}

/** Имя есть в глоссарии (Караганда → Қарағанды) и в тексте — его казахское написание. */
function kkSpelling(name: string, glossary: readonly KzTerm[], text: string): boolean {
  const n = name.toLowerCase().replace(/ё/g, "е");
  const t = glossary.find((g) => g.ru.some((r) => n.startsWith(r.slice(0, Math.max(4, r.length - 2)))));
  return Boolean(t && text.toLowerCase().includes(t.kk.toLowerCase().slice(0, Math.max(3, t.kk.length - 2))));
}

function years(text: string): number[] {
  return [...text.matchAll(/(?<!\d)(1[89]\d{2}|20\d{2})(?!\d)/g)].map((m) => Number(m[1]));
}

// ── Обратный перевод kk → ru другим провайдером ─────────────────────────────

export interface KkBack {
  id: string;
  back_ru: string;
  provider: string;
  model: string;
}

/** Обратный перевод каждой главы (translate kk → ru). `ai` — роутер с режимом другого провайдера (chooseBackMode). */
export async function backTranslateKk(ai: Pick<AiRouter, "runWithMeta">, items: readonly KkItem[]): Promise<{ back: KkBack[]; flags: KkFlag[] }> {
  const back: KkBack[] = [];
  const flags: KkFlag[] = [];
  for (const i of items) {
    const res = await ai.runWithMeta("translate", translateInput("kk", "ru", { text_ru: i.text_kk, title: i.title_kk ?? "", quote: i.quote_kk ?? "" }));
    const text = res.output.text_ko;
    back.push({ id: i.id, back_ru: text, provider: res.provider, model: res.model });
    const lost = [...yearsRu(i.text_ru)].filter((y) => !years(text).includes(y));
    for (const y of lost) flags.push({ id: i.id, rule: "back:years", kk: String(y), issue: `после обратного перевода нет года ${y}`, severity: "major" });
  }
  return { back, flags };
}

// ── Отчёт ────────────────────────────────────────────────────────────────────

export function kkTotals(flags: readonly KkFlag[]): { major: number; minor: number } {
  return { major: flags.filter((f) => f.severity === "major").length, minor: flags.filter((f) => f.severity === "minor").length };
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

/** Строки таблицы флажков (для отчёта eval). */
export function kkFlagRows(rows: readonly { persona: string; flag: KkFlag }[], limit = Number.POSITIVE_INFINITY): string[] {
  if (!rows.length) return ["Флажков нет (это эвристики, не оценка носителя)."];
  const out = ["| Персонаж | Глава | Правило | Фрагмент | Что не так |", "| --- | --- | --- | --- | --- |"];
  const sorted = [...rows].sort((a, b) => (a.flag.severity === b.flag.severity ? 0 : a.flag.severity === "major" ? -1 : 1));
  for (const { persona, flag } of sorted.slice(0, limit))
    out.push(`| ${persona} | ${flag.id} | ${flag.severity === "major" ? "🔴" : "🟡"} ${flag.rule} | ${cell(flag.kk)} | ${cell(flag.issue)} |`);
  if (sorted.length > limit) out.push(`| … | | | | ещё ${sorted.length - limit} в полном отчёте |`);
  return out;
}

export const KK_NOTE =
  "⚠️ Казахский **не проверен носителем** (#232): строки ниже — эвристики без ИИ и обратный перевод другой моделью. " +
  "Ничего не нашлось ≠ перевод хороший.";
