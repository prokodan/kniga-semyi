// #98: пересборка глав, пострадавших до исправления, — по семьям (короткие id из diag → families).
// Что считается пострадавшим (та же логика, что в lib/pipeline/sources.ts):
//  - failed после 3 попыток kick-stuck (перегрузка ИИ) → «Перезапустить сборку» (restart);
//  - готовая глава, в которую не попала запись-уточнение (parent_story_id) → пересборка с edit;
//  - готовая глава, где есть рассказ, уже рассказанный в более ранней главе → пересборка с edit
//    (новый edit сам выкинет повтор; весь ответ — повтор → skipped).
// Вызывает прод POST /api/stories/:id/process с токеном семьи из базы. Токены, имена и тексты в лог не пишет.
// Запуск: Actions → repair-chapters (families, apply). По умолчанию — только показать (dry run).
import { appendFileSync } from "node:fs";
import type { Story } from "@/lib/types";
import { attachChildren, dropRepeats, fullSource } from "@/lib/pipeline/sources";

const SB = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const PROD = (process.env.PROD_URL ?? "").replace(/\/+$/, "");
const SEL = (process.env.REPAIR_FAMILIES ?? "").split(",").map((s) => s.trim()).filter((s) => /^[0-9a-f]{6,36}$/.test(s));
const APPLY = process.env.REPAIR_APPLY === "1";
if (!SB || !KEY || !PROD || SEL.length === 0) {
  console.error("Нужны NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PROD_URL и REPAIR_FAMILIES (короткие id семей)");
  process.exit(1);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
async function rest<T>(path: string): Promise<T> {
  const res = await fetch(`${SB}/rest/v1/${path}`, { headers: H });
  if (!res.ok) throw new Error(`${path.split("?")[0]}: HTTP ${res.status}`);
  return (await res.json()) as T;
}
const short = (id: string) => id.slice(0, 8);
const out: string[] = [];
const log = (l = "") => {
  out.push(l);
  console.log(l);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Row = Pick<Story, "id" | "storyteller_id" | "parent_story_id" | "question_id" | "status" | "error" | "transcript" | "text_ru" | "followups" | "created_at">;

async function call(id: string, token: string, body: Record<string, unknown>) {
  const res = await fetch(`${PROD}/api/stories/${id}/process`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-family-token": token },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(70_000),
  });
  return (await res.json().catch(() => ({ status: `HTTP ${res.status}` }))) as { status?: string; next?: string | null; queued?: boolean; running?: boolean; error?: string | null };
}

/** Довести историю до конца: шаги по одному (сервер и сам ведёт цепочку), до 4 мин. */
async function drive(id: string, token: string, first: Record<string, unknown>): Promise<string> {
  let r = await call(id, token, first);
  const deadline = Date.now() + 4 * 60_000;
  while (Date.now() < deadline && r.status !== "ready" && r.status !== "failed" && r.status !== "skipped") {
    await sleep(r.queued ? 30_000 : 8_000);
    r = await call(id, token, {});
  }
  return `${r.status}${r.queued ? " (очередь ИИ)" : ""}${r.error ? ` — ${String(r.error).slice(0, 90)}` : ""}`;
}

const all = await rest<{ id: string; is_demo: boolean }[]>("families?select=id,is_demo&is_demo=eq.false&limit=1000");
const families = all.filter((f) => SEL.some((s) => f.id.startsWith(s)));
log(`# repair-chapters · ${new Date().toISOString()} · ${APPLY ? "ПЕРЕСБОРКА" : "dry run"} · семей: ${families.length}`);
let fixed = 0;
for (const fam of families) {
  const token = (await rest<{ access_token: string }[]>(`families?select=access_token&id=eq.${fam.id}`))[0]?.access_token;
  if (!token) continue;
  const rows = await rest<Row[]>(
    `stories?select=id,storyteller_id,parent_story_id,question_id,status,error,transcript,text_ru,followups,created_at&family_id=eq.${fam.id}&order=created_at.asc&limit=1000`,
  );
  const plan: { id: string; q: string | null; why: string; body: Record<string, unknown> }[] = [];
  for (const s of rows) {
    if (s.parent_story_id || s.status === "skipped") continue;
    if (s.status === "failed") {
      plan.push({ id: s.id, q: s.question_id, why: `failed: ${String(s.error ?? "").slice(0, 60)}`, body: { restart: true } });
      continue;
    }
    if (s.status !== "ready" || !s.text_ru) continue;
    const kids = rows.filter((k) => k.parent_story_id === s.id) as Pick<Story, "id" | "transcript" | "status" | "created_at">[];
    const { added } = attachChildren(s.followups ?? [], kids);
    const earlier = rows
      .filter((e) => !e.parent_story_id && e.status !== "skipped" && e.storyteller_id === s.storyteller_id && e.created_at < s.created_at)
      .map((e) => ({ id: e.id, source: fullSource(e) }));
    const d = dropRepeats([s.transcript ?? "", ...(s.followups ?? []).map((f) => f.answer)], earlier);
    const why = [added ? `не попало уточнений: ${added}` : "", d.dropped ? `повтор из ${d.repeatsOf.map(short).join(", ")}: ${d.dropped} предл.` : ""].filter(Boolean).join("; ");
    if (why) plan.push({ id: s.id, q: s.question_id, why, body: { from: "edit" } });
  }
  log();
  log(`## Семья ${short(fam.id)} · к пересборке: ${plan.length}`);
  log("| id | вопрос | причина | результат |");
  log("|---|---|---|---|");
  for (const p of plan) {
    const res = APPLY ? await drive(p.id, token, p.body) : "—";
    if (APPLY && /^(ready|skipped)/.test(res)) fixed++;
    log(`| ${short(p.id)} | ${p.q ?? "—"} | ${p.why} | ${res} |`);
  }
}
log();
log(APPLY ? `Готово: исправлено ${fixed}. Книгу после этого пересобрать на /book/<токен> («Пересобрать»).` : "Dry run: ничего не менял. Запустите с apply = true.");
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.join("\n") + "\n");
