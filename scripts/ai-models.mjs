// Подбор актуальных моделей для роутера ИИ (workflow ai-models, запуск вручную).
// 1. models.list Gemini (ключ GEMINI_API_KEY) → новейшие текстовые Gemini 3.x Flash-Lite и Flash
//    (без TTS / Image / Live / preview / exp) и модель Transcribe для аудио, если есть.
// 2. Тестовый запрос к каждой — тем же телом, что lib/ai/providers/gemini.ts (JSON-ответ, thinkingLevel low).
// 3. gpt-5.4-mini — проверка, если задан OPENAI_API_KEY, иначе «не проверено» (#105: gpt-5-mini устаревает;
//    если gpt-5.4-mini не ответила, а gpt-5-mini ответила — резервом остаётся gpt-5-mini, с предупреждением).
// 4. Пишет SQL для ai_routes (OUT_SQL; при платном Gemini — без квот, #194, scripts/ai-models-sql.mjs) и таблицу в summary запуска ($GITHUB_STEP_SUMMARY).
// Ключи не печатаются. Зависимостей нет — Node 22 (fetch). Запуск: node scripts/ai-models.mjs
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { routesSql } from "./ai-models-sql.mjs";

const GEMINI_KEY = process.env.GEMINI_API_KEY?.trim();
const OPENAI_KEY = process.env.OPENAI_API_KEY?.trim();
const OUT_SQL = process.env.OUT_SQL || "ai_routes.sql";
const OUT_JSON = process.env.OUT_JSON || "ai_models.json";
const SUMMARY = process.env.GITHUB_STEP_SUMMARY;
const LIMIT_FL = Number(process.env.FLASH_LITE_DAILY_LIMIT || 500);
const LIMIT_F = Number(process.env.FLASH_DAILY_LIMIT || 20);
const BASE = "https://generativelanguage.googleapis.com/v1beta";

const summary = [];
const md = (s = "") => summary.push(s);
function flushSummary() {
  const text = summary.join("\n") + "\n";
  if (SUMMARY) appendFileSync(SUMMARY, text);
  console.log(text);
}

if (!GEMINI_KEY) {
  md("## 🔴 ai-models: GEMINI_API_KEY не задан в GitHub Secrets");
  md("Settings → Secrets and variables → Actions → New repository secret → `GEMINI_API_KEY`.");
  flushSummary();
  process.exit(1);
}

// ---------- models.list ----------
async function listModels() {
  const all = [];
  let pageToken = "";
  for (let i = 0; i < 20; i++) {
    const url = `${BASE}/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const res = await fetch(url, { headers: { "x-goog-api-key": GEMINI_KEY } });
    if (!res.ok) throw new Error(`models.list: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    all.push(...(json.models ?? []));
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }
  return all.map((m) => ({
    id: String(m.name ?? "").replace(/^models\//, ""),
    displayName: m.displayName ?? "",
    methods: m.supportedGenerationMethods ?? [],
  }));
}

const EXCLUDE = /(tts|image|imagen|live|native-audio|preview|exp|embedding|aqa|thinking|computer|robotics|learnlm|gemma|veo|lyria|banana)/i;

/** gemini-3.5-flash-lite[-001] → { major: 3, minor: 5, suffix: "001" } */
function parse(id, family) {
  const re = family === "flash-lite" ? /^gemini-(\d+)(?:\.(\d+))?-flash-lite(?:-(\d{3}))?$/ : /^gemini-(\d+)(?:\.(\d+))?-flash(?:-(\d{3}))?$/;
  const m = id.match(re);
  return m ? { major: Number(m[1]), minor: Number(m[2] ?? 0), suffix: m[3] ?? "" } : null;
}

/** Кандидаты семейства, новейшие первыми; при равной версии — имя без суффикса (стабильный алиас). */
function candidates(models, family) {
  return models
    .filter((m) => m.methods.includes("generateContent") && !EXCLUDE.test(m.id))
    .map((m) => ({ ...m, v: parse(m.id, family) }))
    .filter((m) => m.v)
    .sort((a, b) => b.v.major - a.v.major || b.v.minor - a.v.minor || (a.v.suffix ? 1 : 0) - (b.v.suffix ? 1 : 0) || b.v.suffix.localeCompare(a.v.suffix));
}

// ---------- тестовые запросы ----------
const usesThinkingLevel = (model) => /^gemini-[3-9]/.test(model);

function generationConfig(model, thinking) {
  const cfg = { responseMimeType: "application/json", temperature: 0.4 };
  if (thinking && usesThinkingLevel(model)) cfg.thinkingConfig = { thinkingLevel: "low" };
  return cfg;
}

/** WAV 1.5 с, 16 кГц, моно — тихий тон: проверяем, что модель принимает аудио и отвечает JSON. */
function testWavBase64() {
  const rate = 16000;
  const n = Math.round(rate * 1.5);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 3000), 44 + i * 2);
  return buf.toString("base64");
}
const WAV = testWavBase64();
const TRANSCRIBE_PROMPT = (() => {
  try {
    return readFileSync("prompts/transcribe.md", "utf8");
  } catch {
    return 'Расшифруй аудио. Ответ — только JSON: {"text": "...", "language": "ru"}';
  }
})();

/** Тест должен быть быстрым: шаг конвейера сам ограничен 30–45 с, медленная модель нам не подходит. */
const CALL_TIMEOUT_MS = Number(process.env.CALL_TIMEOUT_MS || 30_000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function geminiCall(model, kind) {
  const parts =
    kind === "audio"
      ? [{ inline_data: { mime_type: "audio/wav", data: WAV } }, { text: JSON.stringify({ languageHint: "ru", durationSec: 1.5 }) }]
      : [{ text: JSON.stringify({ word: "привет" }) }];
  const system =
    kind === "audio" ? TRANSCRIBE_PROMPT : 'Проверка связи. Ответь только JSON: {"ok": true, "echo": "<слово из запроса>"}';
  // Модель расшифровки (#52) не принимает systemInstruction, JSON-режим и thinkingConfig — только user-части.
  const plainTranscribe = kind === "audio" && /transcri/i.test(model);
  const send = async (thinking) => {
    const started = Date.now();
    let res;
    try {
      res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_KEY },
      body: JSON.stringify(
        plainTranscribe
          ? { contents: [{ role: "user", parts: [{ text: "Расшифруй запись дословно. Только текст." }, parts[0]] }] }
          : {
              systemInstruction: { parts: [{ text: system }] },
              contents: [{ role: "user", parts }],
              generationConfig: generationConfig(model, thinking),
            },
      ),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    } catch (e) {
      // Таймаут или сеть — это неудачная попытка этой модели, а не падение всего подбора.
      const timeout = e?.name === "TimeoutError" || e?.name === "AbortError";
      return { status: 0, body: timeout ? `таймаут ${CALL_TIMEOUT_MS / 1000} с` : `сеть: ${e?.message ?? e}`, ms: Date.now() - started };
    }
    const body = await res.text();
    return { status: res.status, body, ms: Date.now() - started };
  };

  let thinking = true;
  let r;
  for (let attempt = 0; attempt < 3; attempt++) {
    r = await send(thinking);
    if (r.status === 400 && thinking && usesThinkingLevel(model) && /thinking/i.test(r.body)) {
      thinking = false;
      continue;
    }
    if (r.status === 0 && attempt === 0) continue; // таймаут/сеть — ещё одна попытка
    if (r.status === 429 || r.status === 503) {
      await sleep(6000);
      continue;
    }
    break;
  }
  console.log(`  ${model} [${kind}] → ${r.status || "—"} за ${(r.ms / 1000).toFixed(1)} с${thinking ? "" : " (без thinkingLevel)"}`);
  if (r.status === 0) return { ok: false, ms: r.ms, note: r.body };
  // 429 (квота) / 503 (перегрузка) — модель есть, но занята: не повод выкидывать её из маршрутов
  if (r.status === 429 || r.status === 503) return { ok: false, busy: true, ms: r.ms, note: `HTTP ${r.status}: ${shortError(r.body)}` };
  if (r.status !== 200) return { ok: false, ms: r.ms, note: `HTTP ${r.status}: ${shortError(r.body)}` };
  let text = "";
  try {
    text = (JSON.parse(r.body).candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  } catch {
    return { ok: false, ms: r.ms, note: "ответ не JSON" };
  }
  // Ответ модели расшифровки — простой текст (на тестовом гудке может быть пустым): HTTP 200 = формат принят.
  if (plainTranscribe) return { ok: true, ms: r.ms, note: `текст: ${text.slice(0, 40) || "(пусто — тон без речи)"}` };
  let out;
  try {
    out = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return { ok: false, ms: r.ms, note: `модель вернула не JSON: ${text.slice(0, 80)}` };
  }
  if (kind === "text" && out?.ok !== true) return { ok: false, ms: r.ms, note: `неожиданный ответ: ${text.slice(0, 80)}` };
  if (kind === "audio" && typeof out?.text !== "string") return { ok: false, ms: r.ms, note: `нет поля text: ${text.slice(0, 80)}` };
  return { ok: true, ms: r.ms, note: thinking || !usesThinkingLevel(model) ? "" : "без thinkingLevel" };
}

async function openaiCall(model) {
  const started = Date.now();
  let res;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${OPENAI_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: 'Проверка связи. Ответь только JSON: {"ok": true}' },
        { role: "user", content: "{}" },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  } catch (e) {
    return { ok: false, ms: Date.now() - started, note: e?.name === "TimeoutError" ? "таймаут 60 с" : `сеть: ${e?.message ?? e}` };
  }
  const body = await res.text();
  const ms = Date.now() - started;
  if (!res.ok) return { ok: false, ms, note: `HTTP ${res.status}: ${shortError(body)}` };
  try {
    const out = JSON.parse(JSON.parse(body).choices?.[0]?.message?.content ?? "");
    return out?.ok === true ? { ok: true, ms, note: "" } : { ok: false, ms, note: "неожиданный ответ" };
  } catch {
    return { ok: false, ms, note: "ответ не JSON" };
  }
}

function shortError(body) {
  try {
    return String(JSON.parse(body).error?.message ?? body).replace(/\s+/g, " ").slice(0, 160);
  } catch {
    return String(body).replace(/\s+/g, " ").slice(0, 160);
  }
}

/** Первый рабочий кандидат семейства (до 3 попыток), с тестом текста и аудио. */
async function pickWorking(list, label, rows) {
  for (const m of list.slice(0, 3)) {
    const text = await geminiCall(m.id, "text");
    const audio = text.ok ? await geminiCall(m.id, "audio") : { ok: false, ms: 0, note: "—" };
    rows.push({ role: label, model: m.id, text, audio });
    if (text.ok) return { id: m.id, audio: audio.ok };
    if (text.busy) busy.push(`${label} \`${m.id}\``);
  }
  return null;
}
/** Модели, ответившие 429 / 503 (квота, перегрузка). Есть такие — маршруты не переписываем (25.11: выкинуло рабочие). */
const busy = [];

// ---------- main ----------
const rows = [];
let models;
try {
  models = await listModels();
} catch (e) {
  md(`## 🔴 ai-models: ${e.message}`);
  flushSummary();
  process.exit(1);
}

const fl = candidates(models, "flash-lite");
const fla = candidates(models, "flash");
console.log(`models.list: ${models.length}; Flash-Lite: ${fl.map((m) => m.id).join(", ") || "—"}; Flash: ${fla.map((m) => m.id).join(", ") || "—"}`);
const warn = [];
const only3 = (list, name) => {
  const v3 = list.filter((m) => m.v.major >= 3);
  if (v3.length) return v3;
  if (list.length) warn.push(`Gemini 3.x ${name} не найден (без preview) — взят новейший доступный: \`${list[0].id}\``);
  return list;
};

const flashLite = await pickWorking(only3(fl, "Flash-Lite"), "Flash-Lite", rows);
const flash = await pickWorking(only3(fla, "Flash"), "Flash", rows);

// Transcribe: отдельная модель для аудио, если в списке есть (без preview/exp).
const transcribeAll = models.filter((m) => /transcri/i.test(m.id) || /transcri/i.test(m.displayName));
const transcribeList = transcribeAll.filter((m) => m.methods.includes("generateContent") && !/(preview|exp)/i.test(m.id));
let transcribeModel = null;
for (const m of transcribeList.slice(0, 2)) {
  const audio = await geminiCall(m.id, "audio");
  rows.push({ role: "Transcribe", model: m.id, text: { ok: null, ms: 0, note: "—" }, audio });
  if (audio.ok) {
    transcribeModel = m.id;
    break;
  }
}
if (!transcribeList.length) {
  const hidden = transcribeAll.map((m) => m.id);
  rows.push({
    role: "Transcribe",
    model: hidden.length ? hidden.join(", ") : "нет в models.list",
    text: { ok: null, ms: 0, note: "—" },
    audio: { ok: null, ms: 0, note: hidden.length ? "только preview / без generateContent — не включаем" : "аудио расшифровывают Flash-Lite / Flash" },
  });
}

const GPT_MODEL = "gpt-5.4-mini";
const GPT_OLD = "gpt-5-mini";
let gptModel = GPT_MODEL;
let gpt = { ok: null, ms: 0, note: "не проверено: OPENAI_API_KEY не задан" };
if (OPENAI_KEY) gpt = await openaiCall(GPT_MODEL);
rows.push({ role: "Резерв (платный)", model: GPT_MODEL, text: gpt, audio: { ok: null, ms: 0, note: "—" } });
if (gpt.ok === false) {
  const old = await openaiCall(GPT_OLD);
  rows.push({ role: "Резерв (старый)", model: GPT_OLD, text: old, audio: { ok: null, ms: 0, note: "—" } });
  if (old.ok) {
    gptModel = GPT_OLD;
    warn.push(`\`${GPT_MODEL}\` не ответила — резервом оставлен \`${GPT_OLD}\``);
  }
}

// ---------- маршруты ----------
const FL = flashLite && { provider: "gemini", model: flashLite.id, daily_limit: LIMIT_FL, threshold: 0.9 };
const F = flash && { provider: "gemini", model: flash.id, daily_limit: LIMIT_F, threshold: 0.9 };
// #52: отдельная модель расшифровки (gemini-3.5-transcribe) — в маршрут только по явному флагу (после питча)
const USE_T = process.env.USE_TRANSCRIBE_MODEL === "1";
const T = USE_T && transcribeModel && { provider: "gemini", model: transcribeModel };
const GPT = { provider: "openai", model: gptModel };
const WHISPER = { provider: "openai", model: "gpt-4o-transcribe" };
const audioOk = (entry, info) => entry && info?.audio;

const routes = {
  transcribe: [T, audioOk(FL, flashLite) && FL, audioOk(F, flash) && F, WHISPER].filter(Boolean),
  edit: [FL, F, GPT].filter(Boolean),
  translate: [FL, F, GPT].filter(Boolean),
  // #178: ответ интервью ждёт эти шаги — после Flash-Lite сначала Flash (1–2 с), потом gpt (медиана 8 с)
  completeness: [FL, F, GPT].filter(Boolean),
  next_question: [FL, F, GPT].filter(Boolean),
  tale: [FL, F, GPT].filter(Boolean),
  persona_reply: [FL ?? F, GPT].filter(Boolean),
  // I11 (eval): обратный перевод — другая модель, чем у translate (Flash раньше Flash-Lite).
  judge: [FL ?? F, GPT].filter(Boolean),
  back_translate: [F, GPT, FL].filter(Boolean),
};
const TIMEOUTS = { transcribe: 45000, edit: 30000, translate: 30000, completeness: 7000, next_question: 7000, tale: 40000, persona_reply: 20000, judge: 40000, back_translate: 60000 };
const geminiWorks = Boolean(FL || F);
// 25.11: при исчерпанной квоте Flash-Lite 3.5 и Flash 3.6 ответили 429, скрипт выбрал старую 3.1-flash-lite без Flash
// и переписал прод. Теперь при любом 429 / 503 у кандидатов маршруты не меняются — только отчёт.
const unstable = busy.length > 0;

const sql = routesSql(routes, TIMEOUTS);
writeFileSync(
  OUT_SQL,
  (unstable
    ? "-- ai-models: модели заняты (429 / 503) — маршруты не меняем.\nselect step, jsonb_path_query_array(providers, '$[*].model') as models from ai_routes order by step;"
    : sql) + "\n",
);
writeFileSync(OUT_JSON, JSON.stringify({ flashLite: flashLite?.id ?? null, flash: flash?.id ?? null, transcribe: transcribeModel, gpt: { model: gptModel, ...gpt }, routes }, null, 2));

// ---------- summary ----------
const mark = (r) => (r.ok === null ? "—" : r.ok ? `✅ ${(r.ms / 1000).toFixed(1)} с` : "❌");
md(
  unstable
    ? `## 🟡 Модели заняты (429 / 503): ${busy.join(", ")} — ai_routes не меняем, повторите позже (квота Gemini сбрасывается в полночь по Тихоокеанскому)`
    : geminiWorks
      ? "## 🟢 Модели ИИ проверены"
      : "## 🔴 Ни одна модель Gemini не ответила — ai_routes не меняем",
);
md();
md("| Роль | Модель | Текст (JSON) | Аудио | Примечание |");
md("| --- | --- | --- | --- | --- |");
for (const r of rows) {
  const note = [...new Set([r.text.note, r.audio.note].filter((n) => n && n !== "—"))].join("; ");
  md(`| ${r.role} | \`${r.model}\` | ${mark(r.text)} | ${mark(r.audio)} | ${note || ""} |`);
}
md();
for (const w of warn) md(`> ⚠️ ${w}`);
md();
md("### Порядок в `ai_routes`");
md("| Шаг | Порядок |");
md("| --- | --- |");
for (const [step, list] of Object.entries(routes)) md(`| \`${step}\` | ${list.map((e) => `\`${e.model}\``).join(" → ")} |`);
if (transcribeModel && !USE_T) md(`| | \`${transcribeModel}\` проверена, но в transcribe не включена (флаг use_transcribe_model, #52) |`);
md("| `illustrate` | без изменений (`gpt-image-2` → `gpt-image-1.5`) |");
md();
md(`Квоты в сутки: Flash-Lite ${LIMIT_FL}, Flash ${LIMIT_F} (порог 90%) — только если Gemini в базе бесплатный; при \`ai_providers.gemini.paid = true\` (#194) квоты Gemini не пишутся, действует бюджет $. Фактические лимиты — AI Studio → Rate limits.`);
md();
md(
  `<details><summary>Gemini в models.list: ${models.length}</summary>\n\nFlash-Lite: ${fl.map((m) => m.id).join(", ") || "—"}\n\nFlash: ${fla.map((m) => m.id).join(", ") || "—"}\n</details>`,
);
flushSummary();
process.exit(geminiWorks ? 0 : 1);
