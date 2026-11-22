#!/usr/bin/env node
// Подстраховка конвейера (пункт 1): истории, которые стоят на шаге дольше 5 минут, перезапускаются через
// прод POST /api/stories/:id/process (с токеном семьи — новых секретов не нужно). Не больше 3 попыток
// (stories.kick_attempts), потом failed с понятной причиной — семья видит «Перезапустить сборку».
// Ничего персонального в лог не пишет: только начала id и статусы.
// Запуск: workflow kick-stuck (cron раз в 10 мин) или локально с NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PROD_URL.
import { appendFileSync } from "node:fs";

const SB = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const PROD = (process.env.PROD_URL ?? "").replace(/\/+$/, "");
const STALE_MIN = Number(process.env.KICK_STALE_MIN ?? 5);
const MAX_ATTEMPTS = Number(process.env.KICK_MAX_ATTEMPTS ?? 3);
const DRY = process.env.KICK_DRY_RUN === "1";
if (!SB || !KEY || !PROD) {
  console.error("Нужны NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY и PROD_URL");
  process.exit(1);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "content-type": "application/json" };
const LABEL = { uploaded: "расшифровка", transcribing: "расшифровка", editing: "редактура", translating: "перевод" };
const short = (id) => String(id).slice(0, 8);

async function rest(path, init = {}) {
  const res = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`${path.split("?")[0]}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

/** Понятная причина по последней неудачной попытке ИИ этой истории. */
async function cause(storyId) {
  const rows = await rest(`ai_usage?select=status,error&story_id=eq.${storyId}&status=neq.ok&status=neq.cache_hit&order=created_at.desc&limit=1`);
  const r = rows[0];
  if (!r) return "шаг не успел запуститься";
  if (r.status === "timeout") return "модель ИИ не ответила вовремя";
  if (r.status === "rate_limited" || /HTTP 503|429|high demand/i.test(r.error ?? "")) return "модели ИИ были перегружены";
  return "техническая ошибка ИИ";
}

const since = new Date(Date.now() - STALE_MIN * 60_000).toISOString();
const stuck = await rest(
  `stories?select=id,family_id,status,kick_attempts,updated_at&status=in.(uploaded,transcribing,editing,translating)&updated_at=lt.${since}&order=updated_at.asc&limit=40`,
);

const lines = [`# kick-stuck · ${new Date().toISOString()} · застряли > ${STALE_MIN} мин: ${stuck.length}`, ""];
const tokens = new Map();
for (const s of stuck) {
  const tries = s.kick_attempts ?? 0;
  const label = LABEL[s.status] ?? s.status;
  if (tries >= MAX_ATTEMPTS) {
    const error = `Глава не собралась за ${MAX_ATTEMPTS} попытки (шаг «${label}»): ${await cause(s.id)}. Запись сохранена — нажмите «Перезапустить сборку».`;
    if (!DRY)
      await rest(`stories?id=eq.${s.id}&status=eq.${s.status}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "failed", error, step_started_at: null }),
      });
    lines.push(`- ${short(s.id)} ${s.status} → failed (попыток ${tries})`);
    continue;
  }
  if (DRY) {
    lines.push(`- ${short(s.id)} ${s.status} → перезапуск ${tries + 1}/${MAX_ATTEMPTS} (dry run)`);
    continue;
  }
  // Сначала счётчик (с проверкой старого значения — без гонки с соседним запуском)
  await rest(`stories?id=eq.${s.id}&kick_attempts=eq.${tries}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ kick_attempts: tries + 1 }),
  });
  if (!tokens.has(s.family_id)) {
    const f = await rest(`families?select=access_token&id=eq.${s.family_id}`);
    tokens.set(s.family_id, f[0]?.access_token ?? null);
  }
  const token = tokens.get(s.family_id);
  if (!token) {
    lines.push(`- ${short(s.id)} ${s.status} → нет семьи, пропуск`);
    continue;
  }
  const trail = [];
  for (let i = 0; i < 4; i++) {
    let r;
    try {
      const res = await fetch(`${PROD}/api/stories/${s.id}/process`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-family-token": token },
        body: "{}",
        signal: AbortSignal.timeout(70_000),
      });
      r = await res.json().catch(() => ({ status: `HTTP ${res.status}` }));
    } catch (e) {
      trail.push(`сеть: ${e.message.slice(0, 60)}`);
      break;
    }
    trail.push(`${r.ran ?? "—"}→${r.status}${r.queued ? " (очередь)" : ""}${r.running ? " (идёт)" : ""}`);
    if (!r.next || r.queued || r.running || r.status === "failed") break;
  }
  lines.push(`- ${short(s.id)} ${s.status} → перезапуск ${tries + 1}/${MAX_ATTEMPTS}: ${trail.join(", ")}`);
}

const out = lines.join("\n");
console.log(out);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out + "\n");
