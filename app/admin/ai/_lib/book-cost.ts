// #105 п. 6: себестоимость книги — запросы к ИИ и $ на семью. Чистые функции, без базы.
// Семья в расчёте — у неё ≥ 1 готовой главы (stories.status = 'ready', без уточнений-детей), не демо.
// Строка ai_usage относится к семье по family_id (#204), иначе по story_id → stories.family_id.
// Запрос = обращение к модели (ok, error, rate_limited, timeout); попадание в кэш (cache_hit) — не запрос и $0.
// Окружение — по ai_usage.env строки: в базе прода строки превью (staging) приходят без семьи и сюда не попадают,
// поэтому staging считает /admin/ai превью (своя база). Перцентили — линейная интерполяция (как в Excel PERCENTILE).
import { usageFamily } from "@/app/admin/families/_lib/families";

export interface BookCostUsage {
  story_id: string | null;
  family_id?: string | null;
  status: string;
  cost_usd: number | string | null;
  env?: string | null;
}

export interface BookCostStory {
  id: string;
  family_id: string;
  status: string;
  parent_story_id: string | null;
}

export interface BookCostFamily {
  id: string;
  is_demo?: boolean | null;
}

export interface Spread {
  median: number;
  p90: number;
}

export interface BookCostEnv {
  env: "prod" | "staging";
  /** Семей с ≥ 1 готовой главой и хотя бы одной строкой расхода в этом окружении */
  families: number;
  requests: Spread;
  usd: Spread;
  /** Готовых глав на семью — чтобы понимать, насколько «полные» книги в выборке */
  chapters: Spread;
  /** Весь $ / все готовые главы этих семей */
  usdPerChapter: number;
}

const REQUEST_STATUSES = new Set(["ok", "error", "rate_limited", "timeout"]);
const ENVS = ["prod", "staging"] as const;

/** Перцентиль q (0..1) с линейной интерполяцией; пустой список — 0. */
export function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * Math.min(Math.max(q, 0), 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
const spread = (values: number[], digits: number): Spread => ({
  median: round(percentile(values, 0.5), digits),
  p90: round(percentile(values, 0.9), digits),
});

export function bookCost(args: { usage: BookCostUsage[]; stories: BookCostStory[]; families: BookCostFamily[] }): BookCostEnv[] {
  const demo = new Set(args.families.filter((f) => f.is_demo).map((f) => f.id));
  const familyOfStory = new Map(args.stories.map((s) => [s.id, s.family_id]));
  const readyChapters = new Map<string, number>();
  for (const s of args.stories) {
    if (s.status !== "ready" || s.parent_story_id || demo.has(s.family_id)) continue;
    readyChapters.set(s.family_id, (readyChapters.get(s.family_id) ?? 0) + 1);
  }

  return ENVS.map((env) => {
    const perFamily = new Map<string, { requests: number; usd: number }>();
    for (const u of args.usage) {
      if ((u.env && u.env.trim() ? u.env : "prod") !== env) continue;
      const fam = usageFamily(u, familyOfStory);
      if (!fam || !readyChapters.has(fam)) continue;
      const acc = perFamily.get(fam) ?? { requests: 0, usd: 0 };
      if (REQUEST_STATUSES.has(u.status)) acc.requests += 1;
      acc.usd += Number(u.cost_usd) || 0;
      perFamily.set(fam, acc);
    }
    const ids = [...perFamily.keys()];
    const rows = ids.map((id) => perFamily.get(id)!);
    const chapters = ids.map((id) => readyChapters.get(id) ?? 0);
    const totalUsd = rows.reduce((s, r) => s + r.usd, 0);
    const totalChapters = chapters.reduce((s, c) => s + c, 0);
    return {
      env,
      families: ids.length,
      requests: spread(rows.map((r) => r.requests), 1),
      usd: spread(rows.map((r) => r.usd), 4),
      chapters: spread(chapters, 1),
      usdPerChapter: totalChapters > 0 ? round(totalUsd / totalChapters, 4) : 0,
    };
  });
}
