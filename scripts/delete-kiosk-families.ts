// #201: удаление тестовых семей киоска вместе со всем, что к ним относится — без ручного SQL.
// Каскад базы (on delete cascade от families): storytellers, sessions, stories (и уточнения), books, extras,
// demo_orders, family_entities; ai_usage.story_id → null (строки расхода остаются). Плюс файлы Storage
// под «<familyId>/» в бакетах audio, photos, books, illustrations.
// Отказывается удалять демо (is_demo) и семьи, пришедшие сами (source = 'family'); любой отказ — не удаляет ничего.
// В лог и отчёт — только короткий id, источник, дата и числа: без имён (репозиторий публичный), токенов и текстов.
// Запуск: Actions → delete-kiosk-families (families, apply; по умолчанию dry run). Отчёт → Summary и delete-plan.md.
import { appendFileSync, writeFileSync } from "node:fs";
import { ownPaths, parsePrefixes, selectFamilies, type FamilyRow } from "./delete-kiosk-families.plan";

const SB = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const SEL = process.env.DELETE_FAMILIES ?? "";
const APPLY = process.env.DELETE_APPLY === "1";
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "content-type": "application/json" };
const BUCKETS = ["audio", "photos", "books", "illustrations"] as const;
/** Таблицы, которые уходят каскадом вместе с семьёй. */
const CHILDREN = ["storytellers", "sessions", "stories", "books", "extras", "demo_orders", "family_entities"] as const;

async function http(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`${url.replace(SB, "").split("?")[0]}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
  return res;
}

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await http(`${SB}/rest/v1/${path}`, init);
  return (res.status === 204 ? null : await res.json()) as T;
}

/** Число строк без самих строк (Prefer: count=exact → Content-Range «0-0/N» или «* /0»). */
async function count(table: string, filter: string): Promise<number> {
  const res = await http(`${SB}/rest/v1/${table}?select=*&${filter}`, { method: "HEAD", headers: { Prefer: "count=exact", Range: "0-0" } });
  const total = res.headers.get("content-range")?.split("/")[1];
  return total && total !== "*" ? Number(total) : 0;
}

/** Все файлы под папкой бакета (рекурсивно). У папок в ответе id = null. */
async function listFiles(bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await http(`${SB}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: "name", order: "asc" } }),
    });
    const items = (await res.json()) as { name: string; id: string | null }[];
    for (const it of items) {
      const path = `${prefix}${it.name}`;
      if (it.id === null) out.push(...(await listFiles(bucket, `${path}/`)));
      else out.push(path);
    }
    if (items.length < 1000) break;
  }
  return out;
}

async function removeFiles(bucket: string, paths: string[]): Promise<number> {
  let removed = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    const res = await http(`${SB}/storage/v1/object/${bucket}`, { method: "DELETE", body: JSON.stringify({ prefixes: chunk }) });
    removed += ((await res.json()) as unknown[]).length;
  }
  return removed;
}

interface Plan {
  family: FamilyRow;
  rows: Record<(typeof CHILDREN)[number], number>;
  aiUsage: number;
  files: Record<(typeof BUCKETS)[number], string[]>;
  foreign: string[];
}

async function planFor(f: FamilyRow): Promise<Plan> {
  const rows = Object.fromEntries(await Promise.all(CHILDREN.map(async (t) => [t, await count(t, `family_id=eq.${f.id}`)] as const))) as Plan["rows"];
  const stories = await rest<{ id: string; audio_url: string | null }[]>(`stories?select=id,audio_url&family_id=eq.${f.id}&limit=5000`);
  let aiUsage = 0;
  for (let i = 0; i < stories.length; i += 100) {
    aiUsage += await count("ai_usage", `story_id=in.(${stories.slice(i, i + 100).map((s) => s.id).join(",")})`);
  }
  const [st, books] = await Promise.all([
    rest<{ photo_url: string | null; consent_audio_url: string | null }[]>(`storytellers?select=photo_url,consent_audio_url&family_id=eq.${f.id}`),
    rest<{ pdf_url: string | null }[]>(`books?select=pdf_url&family_id=eq.${f.id}`),
  ]);
  const referenced = ownPaths(f.id, [...stories.map((s) => s.audio_url), ...st.flatMap((s) => [s.photo_url, s.consent_audio_url]), ...books.map((b) => b.pdf_url)]);
  const files = Object.fromEntries(await Promise.all(BUCKETS.map(async (b) => [b, await listFiles(b, `${f.id}/`)] as const))) as Plan["files"];
  // ссылки из строк, которых нет среди найденных файлов, — уже удалены / не загружались (показываем числом)
  const listed = new Set(Object.values(files).flat());
  const missing = referenced.own.filter((p) => !listed.has(p)).length;
  if (missing) console.log(`${f.id.slice(0, 8)}: ссылок на файлы без самих файлов — ${missing}`);
  return { family: f, rows, aiUsage, files, foreign: referenced.foreign };
}

async function main() {
  if (!SB || !KEY) throw new Error("Нужны NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY");
  const out: string[] = [];
  const log = (l = "") => {
    out.push(l);
    console.log(l);
  };
  const flush = () => {
    const md = out.join("\n") + "\n";
    writeFileSync("delete-plan.md", md);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  };

  const all = await rest<FamilyRow[]>("families?select=id,source,is_demo,created_at&limit=10000");
  const sel = selectFamilies(parsePrefixes(SEL), all);
  log(`### delete-kiosk-families · ${APPLY ? "🔴 УДАЛЕНИЕ (apply)" : "dry run — ничего не удаляется"} · ${new Date().toISOString()}`);
  log("");
  if (sel.refused.length) {
    log("**Отказ — не удалено ничего.** Исправьте список семей:");
    for (const r of sel.refused) log(`- \`${r.prefix}\` — ${r.reason}`);
    flush();
    process.exit(1);
  }

  const plans: Plan[] = [];
  for (const f of sel.families) plans.push(await planFor(f));

  log("| семья | источник | создана | рассказчики | сессии | истории (вкл. уточнения) | книги | допы | заказы | словарь | ai_usage → null | файлы audio / photos / books / illustrations |");
  log("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const p of plans) {
    const r = p.rows;
    const fl = BUCKETS.map((b) => p.files[b].length).join(" / ");
    log(
      `| \`${p.family.id.slice(0, 8)}\` | ${p.family.source} | ${p.family.created_at.slice(0, 10)} | ${r.storytellers} | ${r.sessions} | ${r.stories} | ${r.books} | ${r.extras} | ${r.demo_orders} | ${r.family_entities} | ${p.aiUsage} | ${fl} |`,
    );
  }
  const foreign = plans.flatMap((p) => p.foreign);
  if (foreign.length) log(`\nСсылки на файлы вне папки семьи (общие, например голоса демо) — **не удаляются**: ${foreign.length}.`);
  log("\nОстаются: демо (`is_demo`), семьи `source=family`, все остальные семьи киоска. Схема базы не меняется.");

  if (!APPLY) {
    log("\nDry run: ничего не удалено. Чтобы удалить — тот же запуск с `apply = true`.");
    flush();
    return;
  }

  log("\n**Результат:**");
  for (const p of plans) {
    const id = p.family.id;
    // 1) файлы — пока строка семьи на месте, повторный запуск найдёт её снова, если что-то упадёт
    let removed = 0;
    for (const b of BUCKETS) if (p.files[b].length) removed += await removeFiles(b, p.files[b]);
    // 2) строка семьи с тем же предохранителем в самом запросе: только киоск и не демо
    const gone = await rest<{ id: string }[]>(`families?id=eq.${id}&source=eq.kiosk&is_demo=eq.false`, {
      method: "DELETE",
      headers: { Prefer: "return=representation" },
    });
    if (gone.length !== 1) throw new Error(`${id.slice(0, 8)}: семья не удалена (удалено строк: ${gone.length})`);
    // 3) проверка: каскад сработал
    const left = await Promise.all(CHILDREN.map((t) => count(t, `family_id=eq.${id}`)));
    const leftFiles = (await Promise.all(BUCKETS.map((b) => listFiles(b, `${id}/`)))).flat().length;
    const ok = left.every((n) => n === 0) && leftFiles === 0;
    log(`- \`${id.slice(0, 8)}\` ${ok ? "✅ удалена" : "⚠️ удалена, но остались хвосты"}: файлов удалено ${removed}; осталось строк ${left.reduce((a, b) => a + b, 0)}, файлов ${leftFiles}`);
  }
  flush();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
