#!/usr/bin/env node
// #98: диагностика связи «ответ → история → глава» по семьям. Лог Actions публичный — поэтому без имён, текстов,
// токенов и ссылок: только короткие id, вопросы банка, статусы, число слов, годы из глав и пересечения текстов.
// Что ищем: один ответ в двух главах (дубль), ответ-уточнение, ставший «главой» без текста (потерян),
// закрытые в сессии вопросы без готовой главы, одна история с разными годами.
// Запуск: Actions → diag → families = 2026-11-24 (семьи с историями с этого дня, без демо) или короткие id через запятую.
import { appendFileSync } from "node:fs";

const URL_ = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
// #168: «… | word:мамо» — где в историях семьи встречается слово (расшифровка, уточнения, глава, словарь семьи).
// Само слово и тексты в лог не идут: только поля и счётчики.
const [SEL_RAW, WORD_RAW] = (process.env.DIAG_FAMILIES ?? "").split("|").map((p) => p.trim());
const SEL = SEL_RAW ?? "";
const WORD = /^word:/i.test(WORD_RAW ?? "") ? WORD_RAW.slice(5).trim().toLowerCase().replace(/ё/g, "е") : "";
if (!URL_ || !KEY || !SEL) {
  console.error("Нужны NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY и DIAG_FAMILIES");
  process.exit(1);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
async function rest(path) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, { headers: H });
  if (!res.ok) throw new Error(`${path.split("?")[0]}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const out = [];
const log = (l = "") => {
  out.push(l);
  console.log(l);
};
const short = (id) => (id ? String(id).slice(0, 8) : "—");
const hhmm = (iso) => new Date(iso).toLocaleString("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const words = (s) => (s ?? "").toLowerCase().replace(/ё/g, "е").match(/[\p{L}\p{N}]+/gu) ?? [];
const years = (s) => [...new Set((s ?? "").match(/\b(19[0-9]{2}|20[0-2][0-9])\b/g) ?? [])].sort().join(" ");
function shingles(s, n = 4) {
  const w = words(s);
  const set = new Set();
  for (let i = 0; i + n <= w.length; i++) set.add(w.slice(i, i + n).join(" "));
  return set;
}
/** Доля шинглов a, найденных в b (0..1) */
function containment(a, b) {
  if (!a.size) return 0;
  let hit = 0;
  for (const x of a) if (b.has(x)) hit++;
  return hit / a.size;
}

// ---- семьи ----
let families;
if (/^\d{4}-\d{2}-\d{2}$/.test(SEL)) {
  // семьи, у которых есть истории с этого дня (по Алматы): семью могли завести раньше, а книгу записывать 24.11
  const recent = await rest(`stories?select=family_id&created_at=gte.${SEL}T00:00:00%2B05:00&limit=5000`);
  const famIds = [...new Set(recent.map((r) => r.family_id))];
  families = famIds.length ? await rest(`families?select=id,is_demo,created_at&id=in.(${famIds.join(",")})&is_demo=eq.false&order=created_at.asc`) : [];
} else {
  const all = await rest(`families?select=id,is_demo,created_at&is_demo=eq.false&order=created_at.desc&limit=500`);
  const want = SEL.split(",").map((s) => s.trim()).filter(Boolean);
  families = all.filter((f) => want.some((w) => f.id.startsWith(w)));
}
log(`# diag-family · ${new Date().toISOString()} · выбор «${SEL}» → семей: ${families.length}`);
log();
log("Глава = история без ↳ (не ответ на уточнение) со статусом ready и текстом. ↳ — ответ на уточнение (только расшифровка).");
log("«дубль» — ≥ 35 % 4-словных фрагментов источника этой главы есть в источнике другой главы (основной ответ + уточнения).");
log();

/** Сколько раз слово (целиком, без регистра, ё=е) встречается в тексте */
function countWord(text) {
  const re = new RegExp(`(^|[^\\p{L}])${WORD.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[^\\p{L}]|$)`, "giu");
  return ((text ?? "").toLowerCase().replace(/ё/g, "е").match(re) ?? []).length;
}

async function wordReport(fam, stories) {
  const rows = [];
  for (const s of stories) {
    const f = {
      transcript: countWord(s.transcript),
      followups: countWord((s.followups ?? []).map((x) => x.answer ?? "").join("\n")),
      text_ru: countWord(s.text_ru),
      title: countWord(s.title),
      quote: countWord(s.quote),
    };
    if (Object.values(f).some(Boolean)) rows.push(`| ${short(s.id)} | ${s.parent_story_id ? "↳" : ""} | ${s.question_id ?? "—"} | ${Object.entries(f).filter(([, n]) => n).map(([k, n]) => `${k}×${n}`).join(" ")} |`);
  }
  const ents = await rest(`family_entities?select=id,type,source,name_ru&family_id=eq.${fam.id}&limit=500`).catch(() => []);
  const entHits = ents.filter((e) => countWord(e.name_ru) > 0).map((e) => `${e.type}/${e.source}`);
  log(`### Слово из запроса · семья ${short(fam.id)}: историй с ним ${rows.length}; в словаре семьи: ${entHits.join(", ") || "нет"}`);
  if (rows.length) {
    log("| id | ↳ | вопрос | где |");
    log("|---|---|---|---|");
    for (const r of rows) log(r);
  }
  log();
}

const totals = { chapters: 0, dups: 0, lostFollowups: 0, orphanParents: 0, answeredNoChapter: 0, failed: 0, stuck: 0 };

for (const fam of families) {
  const stories = await rest(
    `stories?select=id,storyteller_id,session_id,parent_story_id,question_id,block,status,error,audio_url,duration_sec,transcript,text_ru,title,quote,followups,created_at,updated_at&family_id=eq.${fam.id}&order=created_at.asc&limit=500`,
  );
  const sessions = await rest(`sessions?select=id,storyteller_id,mode,state,started_at,ended_at&family_id=eq.${fam.id}&order=started_at.asc&limit=200`);
  const byId = new Map(stories.map((s) => [s.id, s]));
  const ids = stories.map((s) => s.id);
  const usage = ids.length ? await rest(`ai_usage?select=story_id,step,status&story_id=in.(${ids.join(",")})&limit=5000`) : [];
  const calls = new Map();
  for (const u of usage) {
    const m = calls.get(u.story_id) ?? {};
    m[u.step] = (m[u.step] ?? 0) + 1;
    calls.set(u.story_id, m);
  }

  const books = await rest(`books?select=status,built_at,page_count&family_id=eq.${fam.id}&order=created_at.desc&limit=3`);
  if (WORD) await wordReport(fam, stories);
  log(`## Семья ${short(fam.id)} · создана ${hhmm(fam.created_at)} · историй ${stories.length} · сессий ${sessions.length} · книга: ${books.map((b) => `${b.status}${b.built_at ? " " + hhmm(b.built_at) : ""}${b.page_count ? ", " + b.page_count + " с." : ""}`).join("; ") || "нет"}`);
  log();

  // Источник главы: основной ответ + ответы на уточнения (как editSource)
  const src = (s) => [s.transcript ?? "", ...(s.followups ?? []).map((f) => f.answer ?? "")].join("\n");
  const mains = stories.filter((s) => !s.parent_story_id);
  const sh = new Map(mains.map((s) => [s.id, shingles(src(s))]));
  const tsh = new Map(stories.map((s) => [s.id, shingles(s.transcript)]));

  const dupOf = new Map();
  for (const a of mains) {
    if (a.status === "skipped") continue;
    for (const b of mains) {
      if (a.id === b.id || b.status === "skipped") continue;
      const c = containment(sh.get(a.id), sh.get(b.id));
      if (c >= 0.35) dupOf.set(a.id, [...(dupOf.get(a.id) ?? []), `${short(b.id)} ${Math.round(c * 100)}%`]);
    }
  }

  log("| # | id | ↳ основная | вопрос | блок | статус | сессия | создана | слов ответа | уточн. в истории | глава? | годы в главе | вызовы ИИ | дубль с | замечание |");
  log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  stories.forEach((s, i) => {
    const notes = [];
    const parent = s.parent_story_id ? byId.get(s.parent_story_id) : null;
    const chapter = !s.parent_story_id && s.status === "ready" && Boolean(s.text_ru);
    if (chapter) totals.chapters++;
    if (s.parent_story_id) {
      // текст уточнения должен быть в followups основной истории
      const inParent = parent ? containment(tsh.get(s.id), shingles((parent.followups ?? []).map((f) => f.answer ?? "").join("\n"))) : 0;
      if (!parent) {
        notes.push("основная не найдена");
        totals.orphanParents++;
      } else if (s.transcript && words(s.transcript).length >= 4 && inParent < 0.5 && s.status !== "skipped") {
        notes.push(`ответ не попал в уточнения основной (${Math.round(inParent * 100)}%) — ПОТЕРЯН`);
        totals.lostFollowups++;
      }
      if (parent && parent.question_id && s.question_id && parent.question_id !== s.question_id) notes.push(`вопрос ≠ основной (${parent.question_id})`);
    }
    if (dupOf.has(s.id)) totals.dups++;
    if (s.status === "failed") totals.failed++;
    if (!["ready", "failed", "skipped"].includes(s.status) && Date.now() - new Date(s.updated_at).getTime() > 30 * 60000) {
      notes.push("застряла > 30 мин");
      totals.stuck++;
    }
    // то же самое уточнение дважды в одной истории
    const fa = (s.followups ?? []).map((f) => words(f.answer).join(" "));
    if (new Set(fa).size !== fa.length) notes.push("уточнение повторено в истории");
    if (fa.includes(words(s.transcript).join(" ")) && fa.length) notes.push("основной ответ продублирован уточнением");
    const c = calls.get(s.id) ?? {};
    const callsTxt = Object.entries(c).map(([k, v]) => `${k}×${v}`).join(" ");
    log(
      `| ${i + 1} | ${short(s.id)} | ${s.parent_story_id ? "↳" + short(s.parent_story_id) : ""} | ${s.question_id ?? "—"} | ${s.block ?? "—"} | ${s.status} | ${short(s.session_id)} | ${hhmm(s.created_at)} | ${words(s.transcript).length} | ${(s.followups ?? []).length} | ${chapter ? "✓" : ""} | ${years(s.text_ru)} | ${callsTxt} | ${(dupOf.get(s.id) ?? []).join(", ")} | ${[notes.join("; "), s.error ? "ошибка: " + String(s.error).replace(/\|/g, "/").slice(0, 80) : ""].filter(Boolean).join(" · ")} |`,
    );
  });
  log();

  // Главы между собой: похожие тексты глав (3-словные фрагменты) и «чужой» текст в главе — фрагменты главы,
  // которых нет в её источнике, но есть в источнике другой истории (протекло на редактуре или ответ записан не туда).
  const chapters = mains.filter((s) => s.status === "ready" && s.text_ru);
  const c3 = new Map(chapters.map((s) => [s.id, shingles(s.text_ru, 3)]));
  const s3 = new Map(mains.map((s) => [s.id, shingles(src(s), 3)]));
  const stem = (w) => w.slice(0, 5);
  const content = (s) => new Set(words(s).filter((w) => w.length >= 6).map(stem));
  const cw = new Map(chapters.map((s) => [s.id, content(s.text_ru)]));
  const pairs = [];
  for (let i = 0; i < chapters.length; i++)
    for (let j = i + 1; j < chapters.length; j++) {
      const a = chapters[i], b = chapters[j];
      const sim = Math.max(containment(c3.get(a.id), c3.get(b.id)), containment(c3.get(b.id), c3.get(a.id)));
      const A = cw.get(a.id), B = cw.get(b.id);
      let common = 0;
      for (const x of A) if (B.has(x)) common++;
      const jac = common / Math.max(1, A.size + B.size - common);
      if (sim >= 0.15 || jac >= 0.2) pairs.push(`${short(a.id)} (${a.question_id}) ↔ ${short(b.id)} (${b.question_id}): фрагменты ${Math.round(sim * 100)}%, общие слова ${Math.round(jac * 100)}% (${common})`);
    }
  log(`**Похожие главы** (фрагменты ≥ 15 % или общие слова ≥ 20 %): ${pairs.length ? "" : "нет"}`);
  for (const p of pairs) log(`- ${p}`);
  const leaks = [];
  for (const ch of chapters) {
    const own = s3.get(ch.id);
    const mine = c3.get(ch.id);
    for (const other of mains) {
      if (other.id === ch.id) continue;
      let hit = 0;
      for (const x of mine) if (!own.has(x) && s3.get(other.id).has(x)) hit++;
      if (hit >= 4) leaks.push(`${short(ch.id)} (${ch.question_id}) ← ${short(other.id)} (${other.question_id}): ${hit} фрагм. не из своего ответа`);
    }
  }
  // Похожие главы — откуда сходство: какая часть источника A (основной ответ / уточнение k / запись-уточнение) есть в B
  const parts = (s) => [["осн", s.transcript ?? ""], ...(s.followups ?? []).map((f, k) => [`ут${k + 1}`, f.answer ?? ""])];
  const pairIds = [];
  for (let i = 0; i < chapters.length; i++)
    for (let j = i + 1; j < chapters.length; j++) {
      const a = chapters[i], b = chapters[j];
      if (Math.max(containment(c3.get(a.id), c3.get(b.id)), containment(c3.get(b.id), c3.get(a.id))) >= 0.15) pairIds.push([a, b]);
    }
  for (const [a, b] of pairIds) {
    const desc = (x, y) => parts(x).map(([k, t]) => `${k}(${words(t).length} сл.)→${Math.round(containment(shingles(t, 3), s3.get(y.id)) * 100)}%`).join(" ");
    log(`  - источник ${short(a.id)} в ${short(b.id)}: ${desc(a, b)} · обратно: ${desc(b, a)}`);
  }
  // одна и та же запись в двух историях
  const byAudio = new Map();
  for (const s of stories) if (s.audio_url) byAudio.set(s.audio_url, [...(byAudio.get(s.audio_url) ?? []), short(s.id)]);
  const sameAudio = [...byAudio.values()].filter((v) => v.length > 1);
  log(`**Одна запись в нескольких историях:** ${sameAudio.length ? sameAudio.map((v) => v.join(" = ")).join("; ") : "нет"}`);
  // последние ошибки ИИ у failed
  for (const f of stories.filter((s) => s.status === "failed")) {
    const errs = await rest(`ai_usage?select=step,model,status,error&story_id=eq.${f.id}&status=neq.ok&status=neq.cache_hit&order=created_at.desc&limit=3`);
    log(`- failed ${short(f.id)} (${f.question_id}): ${errs.map((e) => `${e.step}/${e.model}/${e.status}: ${String(e.error ?? "").replace(/\s+/g, " ").replace(/\|/g, "/").slice(0, 110)}`).join(" ‖ ") || "ошибок ИИ нет"}`);
  }
  log(`**Чужой текст в главе:** ${leaks.length ? "" : "нет"}`);
  for (const l of leaks) log(`- ${l}`);
  log();

  // Сессии: что агент считает закрытым и есть ли по этим вопросам глава
  const chapterQ = new Map();
  for (const s of mains) if (s.status === "ready" && s.text_ru && s.question_id) chapterQ.set(s.question_id, (chapterQ.get(s.question_id) ?? 0) + 1);
  const anyQ = new Set(stories.map((s) => s.question_id).filter(Boolean));
  log("| сессия | режим | начата | закрыта | текущий вопрос | отвечено | пропущено | позже | offtopic-блоки | отвечено без главы | вопрос с > 1 главой |");
  log("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const se of sessions) {
    const st = se.state ?? {};
    const answered = st.answered_question_ids ?? [];
    const noCh = answered.filter((q) => !chapterQ.has(q));
    totals.answeredNoChapter += noCh.length;
    const multi = [...chapterQ].filter(([q, n]) => n > 1 && answered.includes(q)).map(([q, n]) => `${q}×${n}`);
    log(
      `| ${short(se.id)} | ${se.mode} | ${hhmm(se.started_at)} | ${se.ended_at ? hhmm(se.ended_at) : st.finished ? "finished" : ""} | ${st.current_question_id ?? "—"} | ${answered.join(" ")} | ${(st.skipped_question_ids ?? []).join(" ")} | ${(st.later_question_ids ?? []).join(" ")} | ${(st.offtopic_blocks ?? []).join(" ")} | ${noCh.map((q) => `${q}${anyQ.has(q) ? "" : " (нет истории)"}`).join(" ")} | ${multi.join(" ")} |`,
    );
  }
  log();
}

log("## Итог");
log(`Глав: ${totals.chapters} · глав-дублей: ${totals.dups} · потерянных ответов на уточнение: ${totals.lostFollowups} · уточнений без основной: ${totals.orphanParents} · отвечено без главы: ${totals.answeredNoChapter} · failed: ${totals.failed} · застряли: ${totals.stuck}`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.join("\n") + "\n");
