// #102: словарь семьи (family_entities) для уже собранных глав — без ИИ, из facts и текста готовых глав
// (та же логика, что при сборке новой главы: lib/pipeline/entities.ts). Демо-семью не трогает.
// Повторный запуск безопасен: имена сливаются, записи source='family' не меняются (только story_ids).
// Запуск: Actions → entities-backfill (families: короткие id или all; apply). По умолчанию — dry run.
import { appendFileSync } from "node:fs";
import type { FamilyEntity, Story } from "@/lib/types";
import { entitiesFromChapter, mergeEntities } from "@/lib/pipeline/entities";

const SB = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const SEL = (process.env.BACKFILL_FAMILIES ?? "").trim();
const APPLY = process.env.BACKFILL_APPLY === "1";
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "content-type": "application/json" };

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`${path.split("?")[0]}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
  return (res.status === 204 ? null : await res.json()) as T;
}

async function main() {
  if (!SB || !KEY || !SEL) throw new Error("Нужны NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY и BACKFILL_FAMILIES (короткие id или all)");
  const out: string[] = [];
  const log = (l = "") => {
    out.push(l);
    console.log(l);
  };
  const all = await rest<{ id: string }[]>("families?select=id&is_demo=eq.false&limit=1000");
  const want = SEL === "all" ? null : SEL.split(",").map((s) => s.trim()).filter(Boolean);
  const families = want ? all.filter((f) => want.some((w) => f.id.startsWith(w))) : all;
  log(`# entities-backfill · ${new Date().toISOString()} · ${APPLY ? "ЗАПИСЬ" : "dry run"} · семей: ${families.length}`);
  log("| семья | глав | было записей | + новых | обновлено | люди / места / слова после |");
  log("|---|---|---|---|---|---|");
  for (const fam of families) {
    const chapters = await rest<Pick<Story, "id" | "text_ru" | "facts">[]>(
      `stories?select=id,text_ru,facts&family_id=eq.${fam.id}&status=eq.ready&parent_story_id=is.null&text_ru=not.is.null&order=created_at.asc&limit=500`,
    );
    let list = await rest<FamilyEntity[]>(`family_entities?select=*&family_id=eq.${fam.id}&limit=1000`);
    const before = list.length;
    let added = 0;
    let updated = 0;
    for (const ch of chapters) {
      const { inserts, updates } = mergeEntities(list, entitiesFromChapter(ch), fam.id, ch.id);
      for (const u of updates) {
        if (APPLY) await rest(`family_entities?id=eq.${u.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(u.patch) });
        list = list.map((e) => (e.id === u.id ? { ...e, ...u.patch } : e));
        updated++;
      }
      for (const i of inserts) {
        let row: FamilyEntity = { ...i, id: `new-${list.length}`, updated_at: new Date().toISOString() };
        if (APPLY) row = (await rest<FamilyEntity[]>("family_entities", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(i) }).then((r) => r ?? []))[0] ?? row;
        list.push(row);
        added++;
      }
    }
    const by = (k: string) => list.filter((e) => e.kind === k).length;
    log(`| ${fam.id.slice(0, 8)} | ${chapters.length} | ${before} | ${added} | ${updated} | ${by("person")} / ${by("place")} / ${by("word")} |`);
  }
  if (!APPLY) log("\nDry run: ничего не записано. Запустите с apply = true.");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.join("\n") + "\n");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
