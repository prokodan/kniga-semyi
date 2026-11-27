#!/usr/bin/env node
// Диагностика прода без персональных данных: последние N историй — статус, следующий шаг, ошибка,
// попытки ИИ по шагам (ai_usage), длительность в базе vs размер файла в Storage, updated_at.
// Имён, текстов, расшифровок и ссылок не выводит. Тестовая семья (рассказчик «Данил», не демо) — ★.
// Запуск: Actions → diag (секреты Supabase) или локально: NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/diag.mjs
import { appendFileSync } from "node:fs";

const URL_ = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const LIMIT = Number(process.env.DIAG_LIMIT ?? 30);
if (!URL_ || !KEY) {
  console.error("Нужны NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "content-type": "application/json" };

async function rest(path) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, { headers: H });
  if (!res.ok) throw new Error(`${path.split("?")[0]}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
async function listFolder(prefix) {
  const res = await fetch(`${URL_}/storage/v1/object/list/audio`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
  });
  if (!res.ok) return [];
  return res.json();
}

const short = (id) => (id ? String(id).slice(0, 8) : "—");
const ago = (iso) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 60 ? `${m} мин` : m < 48 * 60 ? `${(m / 60).toFixed(1)} ч` : `${Math.round(m / 1440)} д`;
};
const clean = (s, n = 140) =>
  s ? String(s).replace(/\s+/g, " ").replace(/\|/g, "/").replace(/https?:\/\/\S+/g, "<url>").slice(0, n) : "";
function nextStep(s) {
  if (!s.transcript?.trim()) return "transcribe";
  if (s.parent_story_id) return "—";
  if (!s.text_ru) return "edit";
  if (!s.text_ko) return "translate";
  return "—";
}

const out = [];
const log = (line = "") => {
  out.push(line);
  console.log(line);
};

const stories = await rest(
  `stories?select=id,family_id,storyteller_id,parent_story_id,question_id,block,status,error,audio_url,duration_sec,transcript,text_ru,text_ko,followups,created_at,updated_at&order=created_at.desc&limit=${LIMIT}`,
);
const famIds = [...new Set(stories.map((s) => s.family_id))];
const stIds = [...new Set(stories.map((s) => s.storyteller_id))];
const families = famIds.length ? await rest(`families?select=id,is_demo&id=in.(${famIds.join(",")})`) : [];
const tellers = stIds.length ? await rest(`storytellers?select=id,name&id=in.(${stIds.join(",")})`) : [];
const demo = new Set(families.filter((f) => f.is_demo).map((f) => f.id));
const testTellers = new Set(tellers.filter((t) => /данил/i.test(t.name ?? "")).map((t) => t.id));

const ids = stories.map((s) => s.id);
const usage = ids.length
  ? await rest(`ai_usage?select=story_id,step,provider,model,status,latency_ms,error,created_at&story_id=in.(${ids.join(",")})&order=created_at.asc&limit=2000`)
  : [];
const byStory = new Map();
for (const u of usage) {
  if (!byStory.has(u.story_id)) byStory.set(u.story_id, []);
  byStory.get(u.story_id).push(u);
}

// Размеры файлов: одна выборка на папку <family>/<storyteller>
const sizes = new Map();
const folders = new Set(stories.filter((s) => s.audio_url && !/^https?:/i.test(s.audio_url)).map((s) => s.audio_url.replace(/^audio\//, "").split("/").slice(0, 2).join("/")));
for (const f of folders) {
  for (const o of await listFolder(f)) sizes.set(`${f}/${o.name}`, { bytes: o.metadata?.size ?? null, mime: o.metadata?.mimetype ?? "" });
}

log(`# diag · ${new Date().toISOString()} · последние ${stories.length} историй`);
log();
log("★ — тестовая семья (рассказчик «Данил»), D — демо, ↳ — ответ на уточнение. КБ/с ≈ 4–16 для opus/aac; заметно меньше — файл короче записи.");
log();
log("| # | id | ★ | вопрос | статус | след. шаг | попытки ИИ (шаг: ok/err/timeout/429/cache) | дл. в базе, с | файл, КБ | КБ/с | mime | имя файла = id? | уточн. | создана | обновлена | ошибка |");
log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
stories.forEach((s, i) => {
  const mark = [testTellers.has(s.storyteller_id) && !demo.has(s.family_id) ? "★" : "", demo.has(s.family_id) ? "D" : "", s.parent_story_id ? "↳" + short(s.parent_story_id) : ""].join("");
  const u = byStory.get(s.id) ?? [];
  const steps = {};
  for (const r of u) {
    steps[r.step] ??= { ok: 0, error: 0, timeout: 0, rate_limited: 0, cache_hit: 0 };
    steps[r.step][r.status] = (steps[r.step][r.status] ?? 0) + 1;
  }
  const att = Object.entries(steps).map(([k, v]) => `${k}: ${v.ok}/${v.error}/${v.timeout}/${v.rate_limited}/${v.cache_hit}`).join("; ") || "—";
  const path = s.audio_url ? s.audio_url.replace(/^audio\//, "") : "";
  const f = path ? sizes.get(path) : null;
  const kb = f?.bytes != null ? Math.round(f.bytes / 1024) : path ? "нет файла" : "текст";
  const rate = f?.bytes && s.duration_sec ? (f.bytes / 1024 / Number(s.duration_sec)).toFixed(1) : "";
  const nameMatch = path ? (path.includes(s.id) ? "да" : `нет (${clean(path.split("/").pop(), 40)})`) : "";
  log(
    `| ${i + 1} | ${short(s.id)} | ${mark} | ${s.question_id ?? ""} | ${s.status} | ${nextStep(s)} | ${att} | ${s.duration_sec ?? ""} | ${kb} | ${rate} | ${f?.mime ?? ""} | ${nameMatch} | ${(s.followups ?? []).length} | ${ago(s.created_at)} | ${ago(s.updated_at)} | ${clean(s.error)} |`,
  );
});

const stuck = stories.filter((s) => !["ready", "failed", "skipped"].includes(s.status) && Date.now() - new Date(s.updated_at).getTime() > 5 * 60000);
log();
log(`**Застряли > 5 мин:** ${stuck.length} (${stuck.map((s) => `${short(s.id)} ${s.status}`).join(", ") || "нет"})`);

// Ошибки ИИ за сутки по шагам и моделям (без текстов запросов)
const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const errs = await rest(`ai_usage?select=step,provider,model,status,latency_ms,error&status=neq.ok&status=neq.cache_hit&created_at=gte.${since}&order=created_at.desc&limit=500`);
const agg = new Map();
for (const e of errs) {
  const k = `${e.step} | ${e.provider}/${e.model} | ${e.status}`;
  const a = agg.get(k) ?? { n: 0, lat: 0, sample: clean(e.error, 160) };
  a.n++;
  a.lat = Math.max(a.lat, e.latency_ms ?? 0);
  agg.set(k, a);
}
log();
log("## Ошибки ИИ за 24 ч");
log("| шаг | модель | статус | раз | макс. задержка, мс | пример ошибки |");
log("|---|---|---|---|---|---|");
for (const [k, a] of agg) log(`| ${k} | ${a.n} | ${a.lat} | ${a.sample} |`);

const oks = await rest(`ai_usage?select=step,provider,model,latency_ms&status=eq.ok&created_at=gte.${since}&limit=2000`);
const lat = new Map();
for (const o of oks) {
  const k = `${o.step} | ${o.provider}/${o.model}`;
  const a = lat.get(k) ?? [];
  a.push(o.latency_ms ?? 0);
  lat.set(k, a);
}
log();
log("## Успешные вызовы за 24 ч (задержка)");
log("| шаг | модель | раз | медиана, мс | макс, мс |");
log("|---|---|---|---|---|");
for (const [k, a] of lat) {
  a.sort((x, y) => x - y);
  log(`| ${k} | ${a.length} | ${a[Math.floor(a.length / 2)]} | ${a[a.length - 1]} |`);
}

const routes = await rest("ai_routes?select=step,providers,timeout_ms,enabled,pinned_provider&order=step");
log();
log("## Маршруты ИИ");
log("| шаг | таймаут на модель, мс | цепочка | худший случай, с |");
log("|---|---|---|---|");
for (const r of routes) {
  const chain = (r.providers ?? []).map((p) => `${p.provider}/${p.model}`).join(" → ");
  log(`| ${r.step}${r.enabled ? "" : " (выкл)"}${r.pinned_provider ? ` (pin ${r.pinned_provider})` : ""} | ${r.timeout_ms} | ${chain} | ${Math.round(((r.providers ?? []).length * r.timeout_ms) / 1000)} |`);
}

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.join("\n") + "\n");
