// Сверка «Ключевых фактов» персонажа с текстом (главы или сам разговор). Без ИИ: бесплатно и
// воспроизводимо. Эвристика: годы должны совпасть точно, слова — по основе (первые 4–6 букв),
// чтобы пережить падежи. Грубо, но достаточно, чтобы увидеть потерю или искажение.
//   found     — все годы на месте и ≥ 60% опорных слов
//   distorted — слова на месте, но рядом с ними другой год (±5 лет) вместо эталонного
//   lost      — иначе
export type FactStatus = "found" | "distorted" | "lost";

export interface FactCheck {
  fact: string;
  status: FactStatus;
  detail: string;
}

const STOP = new Set([
  "было", "были", "есть", "этот", "этом", "тогда", "потом", "после", "через", "очень", "который", "которая",
  "своей", "своих", "свой", "году", "года", "годы", "лет",
]);

export function normalize(s: string): string {
  return s.toLowerCase().replace(/ё/g, "е").replace(/[–—]/g, "-");
}

const YEAR_RE = /(?<!\d)(1[89]\d{2}|20\d{2})(?!\d)/g;

export function years(s: string): number[] {
  return [...s.matchAll(YEAR_RE)].map((m) => Number(m[1]));
}

export function stems(s: string): string[] {
  const words = normalize(s)
    .replace(/[^\p{L}\s-]/gu, " ")
    .split(/[\s-]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));
  return [...new Set(words.map((w) => w.slice(0, Math.max(4, Math.min(6, w.length - 1)))))];
}

/** Строка эталона «1957 — окончил школу; 1958–1962 — институт» → отдельные факты. */
export function splitFacts(lines: string[]): string[] {
  return lines.flatMap((l) => l.split(";")).map((f) => f.trim()).filter(Boolean);
}

function sentences(text: string): string[] {
  return normalize(text).split(/(?<=[.!?…])\s+|\n+/).filter((s) => s.trim());
}

/**
 * @param otherYears годы других эталонных фактов: если рядом стоит такой год, это соседний факт,
 *                   а не искажение («переселены в 1937 году в Уштобе» ≠ «родился в 1937»).
 */
export function checkFact(fact: string, text: string, otherYears: readonly number[] = []): FactCheck {
  const norm = normalize(text);
  const ys = years(fact);
  const ws = stems(fact);
  const present = ws.filter((w) => norm.includes(w));
  const ratio = ws.length === 0 ? 1 : present.length / ws.length;
  const missingYears = ys.filter((y) => !years(norm).includes(y));
  const missingWords = ws.filter((w) => !present.includes(w));

  if (missingYears.length === 0 && ratio >= 0.6) {
    return { fact, status: "found", detail: missingWords.length ? `нет слов: ${missingWords.join(", ")}` : "" };
  }
  if (missingYears.length > 0 && present.length > 0) {
    // Ищем «соседний» год в предложении, где есть слова этого факта.
    for (const y of missingYears) {
      for (const sentence of sentences(text)) {
        if (!present.some((w) => sentence.includes(w))) continue;
        const near = years(sentence).find((o) => o !== y && Math.abs(o - y) <= 5 && !otherYears.includes(o));
        if (near !== undefined) return { fact, status: "distorted", detail: `${y} → ${near}` };
      }
    }
  }
  const parts: string[] = [];
  if (missingYears.length) parts.push(`нет года: ${missingYears.join(", ")}`);
  if (missingWords.length) parts.push(`нет слов: ${missingWords.join(", ")}`);
  return { fact, status: "lost", detail: parts.join("; ") };
}

export function checkFacts(keyFacts: string[], text: string): FactCheck[] {
  const facts = splitFacts(keyFacts);
  return facts.map((f) => {
    const own = years(f);
    const others = facts.flatMap(years).filter((y) => !own.includes(y));
    return checkFact(f, text, others);
  });
}

export function tally(checks: FactCheck[]): Record<FactStatus, number> {
  const t: Record<FactStatus, number> = { found: 0, distorted: 0, lost: 0 };
  for (const c of checks) t[c.status] += 1;
  return t;
}
