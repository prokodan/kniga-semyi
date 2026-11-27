// #232 / #256: сверка перевода с золотым набором носителей (eval/golden/<пара>.jsonl) — строка «Носители: ближе N /
// дальше M» в комментарии eval на PR с промптами. Новый перевод абзаца промптом PR → судья ИИ (ai.run("judge") с
// `golden`, промпт eval/judge.golden.md): какой перевод ближе по смыслу к правке носителя — новый или тот, что
// носитель правил. Хуже по смыслу или потерян факт правки — 🔴 по фактам; потерянные числа правки — 🔴 и без судьи.
// Квота: ≤ 8 самых свежих абзацев на пару, один вызов судьи на пару, только в реальном режиме (scripts/eval.ts).
// Судья недоступен — вердикт по chrF, как в #232 (строка так и пишет).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { translateInput } from "@/lib/ai/types";
import type { AiRouter } from "@/lib/ai/router";
import type { BookLang } from "@/lib/types";
import { applyJudge, goldenJudgeItem, goldenLine, judgeGolden, parseGolden, type GoldenEntry, type GoldenVerdict } from "./format";

export const GOLDEN_DIR = path.join("eval", "golden");
/** Квота #256: не больше 8 абзацев на пару (контракт judge.golden — max 8). */
export const GOLDEN_MAX_PER_PAIR = 8;

export async function goldenCheck(opts: { ai: Pick<AiRouter, "run">; dir?: string; maxPerPair?: number; judge?: boolean }): Promise<string[]> {
  const dir = opts.dir ?? GOLDEN_DIR;
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => /^[a-z]{2}-[a-z]{2}\.jsonl$/.test(f)).sort();
  const max = Math.min(opts.maxPerPair ?? GOLDEN_MAX_PER_PAIR, GOLDEN_MAX_PER_PAIR);
  const lines: string[] = [];
  for (const f of files) {
    const pair = f.replace(/\.jsonl$/, "");
    const [from, to] = pair.split("-") as [BookLang, BookLang];
    const entries = parseGolden(readFileSync(path.join(dir, f), "utf8")).filter((e) => e.kind === "chapter");
    if (!entries.length) continue;
    const take = entries.slice(-max); // самые свежие правки
    const checked: { e: GoldenEntry; fresh: string; v: GoldenVerdict }[] = [];
    let skipped = entries.length - take.length;
    for (const e of take) {
      try {
        const out = await opts.ai.run("translate", translateInput(from, to, { text_ru: e.source, title: "", quote: "" }));
        const fresh = (out as { text_ko?: string }).text_ko ?? "";
        if (!fresh.trim()) {
          skipped++;
          continue;
        }
        checked.push({ e, fresh, v: judgeGolden(e, fresh) });
      } catch {
        // пара без промпта, ИИ недоступен — не проверено
        skipped++;
      }
    }
    let verdicts = checked.map((c) => c.v);
    if (checked.length && opts.judge !== false) {
      try {
        const out = await opts.ai.run("judge", { storytellerName: "", manner: "", chapters: [], golden: { pair, items: checked.map((c) => goldenJudgeItem(c.e, c.fresh)) } });
        const byId = new Map((out.golden ?? []).map((s) => [s.id, s]));
        verdicts = checked.map((c) => {
          const s = byId.get(c.e.key);
          return s ? applyJudge(c.v, s) : c.v;
        });
      } catch {
        // судья недоступен — остаётся chrF
      }
    }
    lines.push(goldenLine(pair, verdicts, skipped));
  }
  return lines;
}
