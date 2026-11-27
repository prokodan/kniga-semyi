// #232: сверка перевода с золотым набором носителей (eval/golden/<пара>.jsonl) — строка «Носители: ближе N / дальше M»
// в комментарии eval на PR с промптами. Новый перевод абзаца промптом PR → chrF к правке носителя против chrF перевода,
// который носитель правил. Потерянные числа правки (годы, количества) — 🔴 по фактам. Без судьи-ИИ (судья — #251).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { translateInput } from "@/lib/ai/types";
import type { AiRouter } from "@/lib/ai/router";
import type { BookLang } from "@/lib/types";
import { goldenLine, judgeGolden, parseGolden, type GoldenVerdict } from "./format";

export const GOLDEN_DIR = path.join("eval", "golden");

export async function goldenCheck(opts: { ai: Pick<AiRouter, "run">; dir?: string; maxPerPair?: number }): Promise<string[]> {
  const dir = opts.dir ?? GOLDEN_DIR;
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => /^[a-z]{2}-[a-z]{2}\.jsonl$/.test(f)).sort();
  const lines: string[] = [];
  for (const f of files) {
    const pair = f.replace(/\.jsonl$/, "");
    const [from, to] = pair.split("-") as [BookLang, BookLang];
    const entries = parseGolden(readFileSync(path.join(dir, f), "utf8")).filter((e) => e.kind === "chapter");
    if (!entries.length) continue;
    const take = entries.slice(-(opts.maxPerPair ?? 8)); // самые свежие правки
    const verdicts: GoldenVerdict[] = [];
    let skipped = entries.length - take.length;
    for (const e of take) {
      try {
        const out = await opts.ai.run("translate", translateInput(from, to, { text_ru: e.source, title: "", quote: "" }));
        const fresh = (out as { text_ko?: string }).text_ko ?? "";
        if (!fresh.trim()) {
          skipped++;
          continue;
        }
        verdicts.push(judgeGolden(e, fresh));
      } catch {
        // пара без промпта (kk до L1), ИИ недоступен — не проверено
        skipped++;
      }
    }
    lines.push(goldenLine(pair, verdicts, skipped));
  }
  return lines;
}
