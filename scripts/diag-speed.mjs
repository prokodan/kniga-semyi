#!/usr/bin/env node
// #167: скорость шагов по дням (без персональных данных): ai_usage — задержки ok-вызовов по шагам и моделям,
// 429 / 503 / таймауты, доля фолбэков (ответила не первая модель маршрута); stories — сколько ждёт семья:
// ответ интервью (completeness + next_question на один ответ) и запись → готовая глава.
// Запуск: Actions → diag → families = speed:2026-11-23,2026-11-25 (дни по Алматы).
import { appendFileSync } from "node:fs";

const URL_ = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const DAYS = (process.env.DIAG_FAMILIES ?? "").replace(/^speed:/i, "").split(",").map((d) => d.trim()).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
if (!URL_ || !KEY || DAYS.length === 0) {
  console.error("Нужны NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY и DIAG_FAMILIES=speed:YYYY-MM-DD[,…]");
  process.exit(1);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
async function rest(path) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, { headers: H });
  if (!res.ok) throw new Error(`${path.split("?")[0]}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
/** Все строки (PostgREST отдаёт не больше 1000 за раз) */
async function all(path) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const rows = await rest(`${path}&limit=1000&offset=${off}`);
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}
const out = [];
const log = (l = "") => {
  out.push(l);
  console.log(l);
};
const q = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
};
const sec = (ms) => (ms == null ? "—" : (ms / 1000).toFixed(1));

const routes = Object.fromEntries((await rest("ai_routes?select=step,providers")).map((r) => [r.step, r.providers?.[0]?.model ?? null]));
const STEPS = ["transcribe", "completeness", "next_question", "edit", "translate"];

log(`# diag-speed · ${new Date().toISOString()} · дни (Алматы): ${DAYS.join(", ")}`);
log();
log("Задержка — один вызов модели (ok), с; «фолбэк» — ответила не первая модель маршрута (сейчас), до неё были отказы.");
log();

const summary = [];
for (const day of DAYS) {
  const from = `${day}T00:00:00%2B05:00`;
  const to = new Date(Date.parse(`${day}T00:00:00+05:00`) + 86400_000).toISOString();
  const usage = await all(`ai_usage?select=story_id,step,provider,model,status,latency_ms,error,created_at&created_at=gte.${from}&created_at=lt.${to}&order=created_at.asc`);
  const stories = await all(
    `stories?select=id,family_id,parent_story_id,status,created_at,updated_at&created_at=gte.${from}&created_at=lt.${to}&order=created_at.asc`,
  );
  log(`## ${day} · вызовов ИИ ${usage.length} · историй ${stories.length}`);
  log();
  log("| шаг | ok | медиана, с | p90, с | модели (ok) | фолбэк | 429 | 503 / ошибка | таймаут | кэш |");
  log("|---|---|---|---|---|---|---|---|---|---|");
  const row = { day };
  for (const step of STEPS) {
    const u = usage.filter((x) => x.step === step);
    const ok = u.filter((x) => x.status === "ok");
    const lat = ok.map((x) => x.latency_ms ?? 0);
    const models = {};
    for (const x of ok) models[x.model] = (models[x.model] ?? 0) + 1;
    const fallback = ok.filter((x) => routes[step] && x.model !== routes[step]).length;
    const n = (st) => u.filter((x) => x.status === st).length;
    const e503 = u.filter((x) => x.status === "error").length;
    log(
      `| ${step} | ${ok.length} | ${sec(q(lat, 0.5))} | ${sec(q(lat, 0.9))} | ${Object.entries(models).map(([m, c]) => `${m}×${c}`).join(", ") || "—"} | ${fallback} | ${n("rate_limited")} | ${e503} | ${n("timeout")} | ${n("cache_hit")} |`,
    );
    row[step] = q(lat, 0.5);
  }
  log();

  // Ответ интервью: completeness + next_question одной истории (интервью вызывает их подряд после ответа)
  const byStory = new Map();
  for (const x of usage) {
    if (!x.story_id) continue;
    const a = byStory.get(x.story_id) ?? [];
    a.push(x);
    byStory.set(x.story_id, a);
  }
  // Запись → глава: от создания основной истории до последнего ok translate (без уточнений и ожидания интервью ≠ работа ИИ)
  const chapter = [];
  const holds = [];
  for (const s of stories.filter((s) => !s.parent_story_id && s.status === "ready")) {
    const u = byStory.get(s.id) ?? [];
    const tr = u.filter((x) => x.step === "translate" && (x.status === "ok" || x.status === "cache_hit")).at(-1);
    const ed = u.find((x) => x.step === "edit");
    const tx = u.filter((x) => x.step === "transcribe" && x.status === "ok").at(-1);
    if (tr) chapter.push(Date.parse(tr.created_at) - Date.parse(s.created_at));
    // сколько глава ждала после расшифровки до первой попытки edit (интервью #86 / проверка #140)
    if (tx && ed) holds.push(Date.parse(ed.created_at) - Date.parse(tx.created_at));
  }
  // interview: время ответа ≈ сумма латентностей completeness + next_question в пределах 2 мин после расшифровки
  const turn = [];
  for (const [, u] of byStory) {
    const c = u.filter((x) => x.step === "completeness" || x.step === "next_question");
    if (!c.length) continue;
    turn.push(c.reduce((a, x) => a + (x.latency_ms ?? 0), 0));
  }
  log(`- ИИ на один ответ интервью (completeness + next_question, вкл. отказы): медиана ${sec(q(turn, 0.5))} с, p90 ${sec(q(turn, 0.9))} с (ответов ${turn.length})`);
  log(`- Запись → готовая глава: медиана ${sec(q(chapter, 0.5))} с, p90 ${sec(q(chapter, 0.9))} с (глав ${chapter.length})`);
  log(`- Расшифровка готова → первая попытка edit (ожидание интервью / проверки полноты): медиана ${sec(q(holds, 0.5))} с, p90 ${sec(q(holds, 0.9))} с`);
  log();
  row.turn = q(turn, 0.5);
  row.chapter = q(chapter, 0.5);
  row.hold = q(holds, 0.5);
  summary.push(row);
}

if (summary.length >= 2) {
  const [a, b] = [summary[0], summary.at(-1)];
  log(`## Сравнение медиан ${a.day} → ${b.day}, с`);
  log();
  log("| что | было | стало |");
  log("|---|---|---|");
  for (const k of [...STEPS, "turn", "hold", "chapter"]) {
    const name = { turn: "ответ интервью (ИИ)", hold: "расшифровка → edit", chapter: "запись → глава" }[k] ?? k;
    log(`| ${name} | ${sec(a[k])} | ${sec(b[k])} |`);
  }
}

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.join("\n") + "\n");
