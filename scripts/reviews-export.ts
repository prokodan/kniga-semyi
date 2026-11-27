// #232: выгрузка отзывов носителей из базы (prod | staging — выбирает workflow reviews-export) в репозиторий:
//   eval/reviews/<дата ссылки>-<пара>-<инициалы>.md — оригинал, перевод модели, правка носителя (diff), оценки, комментарии;
//   eval/golden/<пара>.jsonl — правки абзацев (золотой набор; одна строка на абзац, новая правка заменяет старую).
// Повторный запуск перезаписывает файлы тех же ссылок (идемпотентно). В логи — только числа и короткие id, без текстов и токенов.
// Запуск: NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/reviews-export.ts
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { SupabaseReviewStore } from "@/app/admin/reviews/_lib/repo";
import { goldenFromLink, mergeGolden, parseGolden, renderGolden, renderReviewMarkdown, reviewFileName, type GoldenEntry } from "@/eval/reviews/format";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Нужны NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY");
  const root = process.env.REVIEWS_ROOT ?? process.cwd();
  const store = new SupabaseReviewStore(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }));

  const links = (await store.links()).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const taken = new Set<string>();
  const golden = new Map<string, GoldenEntry[]>();
  const lines: string[] = [];
  let files = 0;
  for (const l of links) {
    const bundle = await store.bundle(l);
    const name = reviewFileName(l, taken);
    if (!bundle.feedback.length) {
      lines.push(`- ${l.id.slice(0, 8)} ${l.pair} ${l.reviewer_label}: отзывов нет`);
      continue;
    }
    const dir = path.join(root, "eval", "reviews");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, name), renderReviewMarkdown(bundle), "utf8");
    files++;
    const g = goldenFromLink(bundle);
    golden.set(l.pair, [...(golden.get(l.pair) ?? []), ...g]);
    lines.push(`- ${l.id.slice(0, 8)} ${l.pair} ${l.reviewer_label}: отзывов ${bundle.feedback.length}, правок в золотой набор ${g.length} → eval/reviews/${name}`);
  }

  for (const [pair, entries] of golden) {
    const dir = path.join(root, "eval", "golden");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${pair}.jsonl`);
    const before = existsSync(file) ? parseGolden(readFileSync(file, "utf8")) : [];
    const merged = mergeGolden(before, entries);
    writeFileSync(file, renderGolden(merged), "utf8");
    lines.push(`- золотой набор ${pair}: было ${before.length}, стало ${merged.length}`);
  }

  const summary = [`### reviews-export: ссылок ${links.length}, файлов отзывов ${files}`, "", ...lines, ""].join("\n");
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
