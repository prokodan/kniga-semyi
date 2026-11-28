// #155: одно написание имён в уже готовых главах — пакетный проход без ИИ (логика — lib/pipeline/spellings.ts).
// По каждой семье: люди и места словаря → корейские варианты в готовых главах → одно написание (словарь, иначе самое
// частое) → замена в text_ko / title_ko / quote_ko, пустой name_ko заполняется; книга помечается устаревшей (draft),
// семья пересобирает PDF. Демо-семью не трогает. Повторный запуск безопасен (второй раз менять нечего).
// #245: текст глав — story_texts, если строка есть, иначе колонки (пишем по-прежнему в колонки — зеркало триггером).
// В лог и summary — только короткие id и числа: ни имён, ни текстов, ни токенов (репозиторий публичный).
// Запуск: Actions → spellings-backfill (families: короткие id из diag или all; apply). По умолчанию — dry run.
import { appendFileSync } from "node:fs";
import type { FamilyEntity } from "@/lib/types";
import { withStoryTexts, type StoryTextRow } from "@/lib/book/texts";
import { planSpellings, type SpellingChapter } from "@/lib/pipeline/spellings";

const SB = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const SEL = (process.env.SPELLINGS_FAMILIES ?? "").trim();
const APPLY = process.env.SPELLINGS_APPLY === "1";
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "content-type": "application/json" };

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`${path.split("?")[0]}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
  return (res.status === 204 ? null : await res.json()) as T;
}

/** #245: story_texts глав (по 100 id за запрос); нет таблицы / ошибка — пусто: читаем колонки, как раньше. */
async function storyTexts(ids: readonly string[]): Promise<StoryTextRow[]> {
  const rows: StoryTextRow[] = [];
  try {
    for (let i = 0; i < ids.length; i += 100)
      rows.push(...(await rest<StoryTextRow[]>(`story_texts?select=story_id,lang,title,text,quote&story_id=in.(${ids.slice(i, i + 100).join(",")})`)));
  } catch {
    return [];
  }
  return rows;
}

const PATCH = { method: "PATCH", headers: { Prefer: "return=minimal" } } as const;

async function main() {
  if (!SB || !KEY || !SEL) throw new Error("Нужны NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY и SPELLINGS_FAMILIES (короткие id или all)");
  const out: string[] = [];
  const log = (l = "") => {
    out.push(l);
    console.log(l);
  };
  const all = await rest<{ id: string }[]>("families?select=id&is_demo=eq.false&limit=1000");
  const want = SEL === "all" ? null : SEL.split(",").map((s) => s.trim()).filter(Boolean);
  const families = want ? all.filter((f) => want.some((w) => f.id.startsWith(w))) : all;
  log(`# spellings-backfill · ${new Date().toISOString()} · ${APPLY ? "ЗАПИСЬ" : "dry run"} · семей: ${families.length}`);
  log("");
  log("| семья | глав | людей и мест | имён с разнобоем | вариантов → одно | замен | глав изменится | пропущено (осторожность) | в словарь |");
  log("|---|---|---|---|---|---|---|---|---|");
  let totalChapters = 0;
  for (const fam of families) {
    const rawChapters = await rest<SpellingChapter[]>(
      `stories?select=id,created_at,title,quote,text_ru,title_ko,quote_ko,text_ko&family_id=eq.${fam.id}&status=eq.ready&parent_story_id=is.null&text_ko=not.is.null&order=created_at.asc&limit=500`,
    );
    const texts = await storyTexts(rawChapters.map((c) => c.id));
    const chapters = rawChapters.map((c) => withStoryTexts(c, texts));
    const entities = await rest<FamilyEntity[]>(`family_entities?select=id,kind,name_ru,name_ko,source&family_id=eq.${fam.id}&kind=in.(person,place)&limit=1000`);
    const plan = planSpellings(entities, chapters);
    const mixed = plan.entities.filter((e) => e.variants.length);
    const learned = plan.entities.filter((e) => e.learn);
    const replaced = plan.chapters.reduce((n, c) => n + c.replaced, 0);
    const skipped = plan.entities.reduce((n, e) => n + e.skipped, 0);
    log(
      `| ${fam.id.slice(0, 8)} | ${chapters.length} | ${entities.length} | ${mixed.length} | ${mixed.reduce((n, e) => n + e.variants.length, 0)} → ${mixed.length} | ${replaced} | ${plan.chapters.length} | ${skipped} | ${learned.length} |`,
    );
    for (const e of plan.entities)
      console.log(
        `  ${fam.id.slice(0, 8)} · запись ${e.id.slice(0, 8)} (${e.kind}): вариантов ${e.variants.length} (${e.variants.map((v) => v.count).join("+") || "—"} раз), глав ${e.chapters}, пропущено ${e.skipped}${e.learn ? ", в словарь" : ""}`,
      );
    if (!APPLY) continue;
    for (const c of plan.chapters) {
      // только если глава всё ещё готова — не мешаем конвейеру, который мог взять её в работу
      await rest(`stories?id=eq.${c.id}&status=eq.ready`, { ...PATCH, body: JSON.stringify({ title_ko: c.title_ko, quote_ko: c.quote_ko, text_ko: c.text_ko }) });
    }
    for (const e of learned) {
      const to = e.to;
      await rest(`family_entities?id=eq.${e.id}&name_ko=is.null`, { ...PATCH, body: JSON.stringify({ name_ko: to }) });
    }
    if (plan.chapters.length) await rest(`books?family_id=eq.${fam.id}&status=eq.ready`, { ...PATCH, body: JSON.stringify({ status: "draft" }) });
    totalChapters += plan.chapters.length;
  }
  log("");
  if (APPLY) log(`Записано: глав ${totalChapters}. Книги этих семей помечены «пересобрать» — PDF пересобирается кнопкой на /book.`);
  else log("Dry run: ничего не записано. Проверьте план и запустите с apply = true.");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.join("\n") + "\n");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
