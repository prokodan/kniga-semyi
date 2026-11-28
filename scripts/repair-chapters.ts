// #98: пересборка глав, пострадавших до исправления, — по семьям (короткие id из diag → families).
// Что считается пострадавшим (та же логика, что в lib/pipeline/sources.ts):
//  - failed после 3 попыток kick-stuck (перегрузка ИИ) → «Перезапустить сборку» (restart);
//  - готовая глава, в которую не попала запись-уточнение (parent_story_id) → пересборка с edit;
//  - готовая глава, где есть рассказ, уже рассказанный в более ранней главе → пересборка с edit
//    (новый edit сам выкинет повтор; весь ответ — повтор → skipped);
//  - #163: готовая глава с кириллицей в корейском тексте → пересборка с translate (ответ модели из кэша,
//    кириллицу убирает lib/pipeline/cyrillic.ts — денег не стоит);
//  - #183: готовая глава, где в абзаце с 손주 / 손자 / 손녀 / 얘들아 есть 해요체 (правило #154: к внукам — 해라체),
//    → пересборка только с translate: транскрипт и edit не трогаются. Промпт translate новый → вход другой →
//    это ПЛАТНЫЙ вызов (≈ 1 на главу). Детектор — тот же, что флажок style:grandkids в kr-check (eval/kr-check.ts).
//  - #298 (флаг lang_kk): готовая глава книги RU + KZ, где в казахском переводе ИИ (story_texts, origin ai) латиница /
//    хангыль (`kk-script`) или к внукам и «сендер», и «сіздер» в одном абзаце (`kk-style`) → пересборка с translate:
//    промпт translate.kk.md новый → платный вызов (≈ 1 на главу); защиты lib/pipeline/kk.ts применятся сами.
//    Только семьи, у которых kk в book_langs и lang_kk в labs (в проде флаг выключен — иначе translate ушёл бы в KR).
//    #312: target staging — флаги сайта staging (REPAIR_FLAGS_ON = FLAGS_ON превью, `*` = все): lang_kk там у всех.
//    Правки людей (origin family / proofread) не трогаем. Детекторы — те же, что флажки kk-check (eval/kk-check.ts).
// Фильтр причин — REPAIR_REASONS (failed, edit, cyrillic, grandkids, kk-script, kk-style; пусто / all — все).
// Предохранители apply: больше REPAIR_MAX_CHAPTERS глав (30) или OpenAI за сегодня (UTC, как бюджет роутера)
// дороже REPAIR_MAX_OPENAI_USD ($1) — ничего не пересобирает, только план. Демо-семья не трогается никогда.
// #312: REPAIR_TARGET prod | staging — база и сайт выбирает workflow (секреты STAGING_*, адрес — STAGING_URL в PROD_URL).
// Вызывает сайт (прод или staging) POST /api/stories/:id/process с токеном семьи из базы. Токены, имена и тексты в лог не пишет.
// #333 (#245): тексты глав — по правилу story_texts → колонки (`withStoryTexts`), строки story_texts семьи одной
// загрузкой (ru / ko / kk; казахские переводы ИИ — из тех же строк, origin ai). До migrate таблицы нет — колонки.
// Запуск: Actions → repair-chapters (families, apply). По умолчанию — только показать (dry run).
import { appendFileSync } from "node:fs";
import type { Story, StoryText } from "@/lib/types";
import { withStoryTexts, type StoryTextRow } from "@/lib/book/texts";
import { grandkidsHaeyo } from "@/eval/kr-check";
import { hasCyrillic } from "@/lib/pipeline/cyrillic";
import { kkProblems } from "@/lib/pipeline/kk";
import { attachChildren, dropRepeats, fullSource } from "@/lib/pipeline/sources";

const SB = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const PROD = (process.env.PROD_URL ?? "").replace(/\/+$/, "");
const RAW_FAMILIES = (process.env.REPAIR_FAMILIES ?? "").trim();
const ALL_FAMILIES = RAW_FAMILIES.toLowerCase() === "all";
const SEL = ALL_FAMILIES ? ["all"] : RAW_FAMILIES.split(",").map((s) => s.trim()).filter((s) => /^[0-9a-f]{6,36}$/.test(s));
const APPLY = process.env.REPAIR_APPLY === "1";
const ALL_REASONS = ["failed", "edit", "cyrillic", "grandkids", "kk-script", "kk-style"] as const;
type Reason = (typeof ALL_REASONS)[number];
const REASONS_RAW = (process.env.REPAIR_REASONS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const REASONS = new Set<Reason>(
  REASONS_RAW.length === 0 || REASONS_RAW.includes("all") ? [...ALL_REASONS] : (REASONS_RAW as Reason[]),
);
const TARGET = process.env.REPAIR_TARGET === "staging" ? "staging" : "prod";
/**
 * #312: флаги сайта, куда ходим — `flags_on` из его /api/health (staging: FLAGS_ON=* → все; прод — пусто). Не ответил —
 * флагов сайта нет (только labs семьи, как раньше). REPAIR_FLAGS_ON (через запятую, `*` = все) — вместо health.
 */
const FLAGS_ON = new Set<string>();
const siteFlag = (name: string) => FLAGS_ON.has("*") || FLAGS_ON.has(name);
async function loadSiteFlags(): Promise<string> {
  const env = (process.env.REPAIR_FLAGS_ON ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (env.length) {
    for (const f of env) FLAGS_ON.add(f);
    return `REPAIR_FLAGS_ON: ${env.join(", ")}`;
  }
  try {
    const res = await fetch(`${PROD}/api/health`, { signal: AbortSignal.timeout(20_000) });
    const j = (await res.json()) as { flags_on?: unknown; env?: unknown };
    for (const f of Array.isArray(j.flags_on) ? j.flags_on : []) if (typeof f === "string") FLAGS_ON.add(f);
    return `флаги сайта (health${typeof j.env === "string" ? `, env ${j.env}` : ""}): ${[...FLAGS_ON].join(", ") || "нет"}`;
  } catch (e) {
    return `флаги сайта не прочитаны (${(e as Error).message.slice(0, 60)}) — только labs семей`;
  }
}
const MAX_CHAPTERS = Number(process.env.REPAIR_MAX_CHAPTERS || 30);
const MAX_OPENAI_USD = Number(process.env.REPAIR_MAX_OPENAI_USD || 1);
if (!SB || !KEY || !PROD || SEL.length === 0) {
  console.error("Нужны NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PROD_URL и REPAIR_FAMILIES (короткие id семей или all)");
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

type Row = Pick<
  Story,
  | "id"
  | "storyteller_id"
  | "parent_story_id"
  | "question_id"
  | "status"
  | "error"
  | "transcript"
  | "text_ru"
  | "title"
  | "quote"
  | "text_ko"
  | "title_ko"
  | "quote_ko"
  | "followups"
  | "created_at"
>;

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

// tsx запускает .ts как CommonJS — без top-level await
async function main() {
  // "*": book_langs / labs появились миграциями — до migrate запрос не должен падать
  const all = await rest<{ id: string; is_demo: boolean; book_langs?: string[] | null; labs?: string[] | null }[]>("families?select=*&is_demo=eq.false&limit=1000");
  // демо-семья отсеяна уже запросом (is_demo=false) — её не трогаем ни при каком выборе
  const families = ALL_FAMILIES ? all : all.filter((f) => SEL.some((s) => f.id.startsWith(s)));
  const flagsNote = await loadSiteFlags();
  log(`# repair-chapters · ${TARGET} · ${new Date().toISOString()} · ${APPLY ? "ПЕРЕСБОРКА" : "dry run"} · семей: ${families.length} (без демо) · причины: ${[...REASONS].join(", ")}`);
  log(flagsNote);

  type Plan = { id: string; q: string | null; why: string; body: Record<string, unknown>; paid: boolean };
  const plans: { fam: string; token: string; plan: Plan[] }[] = [];
  for (const fam of families) {
    const token = (await rest<{ access_token: string }[]>(`families?select=access_token&id=eq.${fam.id}`))[0]?.access_token;
    if (!token) continue;
    const raw = await rest<Row[]>(
      `stories?select=id,storyteller_id,parent_story_id,question_id,status,error,transcript,text_ru,title,quote,text_ko,title_ko,quote_ko,followups,created_at&family_id=eq.${fam.id}&order=created_at.asc&limit=1000`,
    );
    // #333: тексты — строка story_texts, иначе колонки (как книга и страница главы); одна загрузка на семью
    const texts = await textRows(raw.map((r) => r.id));
    const rows = raw.map((r) => withStoryTexts(r, texts));
    const plan: Plan[] = [];
    // #298: казахские переводы ИИ — только семьям с kk в книге и флагом lang_kk (иначе translate переведёт на KR);
    // #312: флаг — у семьи в labs или у всего сайта (staging: FLAGS_ON=*)
    const kkOn = (fam.book_langs ?? []).includes("kk") && ((fam.labs ?? []).includes("lang_kk") || siteFlag("lang_kk"));
    const kkTexts = kkOn && (REASONS.has("kk-script") || REASONS.has("kk-style")) ? kkRows(texts) : new Map<string, KkRow>();
    for (const s of rows) {
      if (s.parent_story_id || s.status === "skipped") continue;
      if (s.status === "failed") {
        if (REASONS.has("failed")) plan.push({ id: s.id, q: s.question_id, why: `failed: ${String(s.error ?? "").slice(0, 60)}`, body: { restart: true }, paid: true });
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
      if (why && REASONS.has("edit")) {
        plan.push({ id: s.id, q: s.question_id, why, body: { from: "edit" }, paid: true });
        continue;
      }
      // с translate: кириллица (#163, из кэша) и / или 해요체 к внукам (#183, новый промпт — платно)
      const cyr = REASONS.has("cyrillic") && hasCyrillic(s.text_ko, s.title_ko, s.quote_ko);
      const gk = REASONS.has("grandkids") ? grandkidsHaeyo(s.text_ko) : [];
      if (cyr || gk.length) {
        const whyT = [cyr ? "кириллица в корейском (#163)" : "", gk.length ? `해요체 к внукам (#154), абз. ${gk.map((g) => g.paragraph).join(", ")}` : ""]
          .filter(Boolean)
          .join("; ");
        plan.push({ id: s.id, q: s.question_id, why: whyT, body: { from: "translate" }, paid: gk.length > 0 });
        continue;
      }
      // #298: казахский перевод — алфавит / обращение к внукам (в лог — только правило и номера абзацев, без текста)
      const kt = kkTexts.get(s.id);
      if (kt) {
        const p = kkProblems(kt, s.text_ru);
        const whyK = [
          REASONS.has("kk-script") && p.script.length ? `не по алфавиту в казахском (#298): ${p.script.length} сл.` : "",
          REASONS.has("kk-style") && p.style.length ? `к внукам «сендер» и «сіздер» (#298), абз. ${p.style.map((m) => m.paragraph).join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("; ");
        if (whyK) plan.push({ id: s.id, q: s.question_id, why: whyK, body: { from: "translate" }, paid: true });
      }
    }
    plans.push({ fam: fam.id, token, plan });
  }

  const total = plans.reduce((n, p) => n + p.plan.length, 0);
  const paid = plans.reduce((n, p) => n + p.plan.filter((x) => x.paid).length, 0);
  const spent = await openaiSpentToday();
  log(`К пересборке: **${total}** глав в ${plans.filter((p) => p.plan.length).length} семьях · платных вызовов ≈ ${paid} · OpenAI за сегодня (UTC): ${spent === null ? "не прочитано" : `$${spent.toFixed(2)}`}`);
  let stop = "";
  if (APPLY && total > MAX_CHAPTERS) stop = `глав ${total} > ${MAX_CHAPTERS} (REPAIR_MAX_CHAPTERS) — нужен явный «да» человека`;
  else if (APPLY && paid > 0 && (spent === null || spent > MAX_OPENAI_USD))
    stop = `OpenAI за сегодня ${spent === null ? "не прочитан" : `$${spent.toFixed(2)}`} > $${MAX_OPENAI_USD} (REPAIR_MAX_OPENAI_USD) — бюджет нужен на питч`;
  if (stop) log(`\n**⛔ Остановлено, ничего не пересобрано:** ${stop}.`);

  let fixed = 0;
  for (const { fam, token, plan } of plans) {
    if (!plan.length) continue;
    log();
    log(`## Семья ${short(fam)} · к пересборке: ${plan.length}`);
    log("| id | вопрос | причина | результат |");
    log("|---|---|---|---|");
    for (const p of plan) {
      const res = APPLY && !stop ? await drive(p.id, token, p.body) : "—";
      if (APPLY && !stop && /^(ready|skipped)/.test(res)) fixed++;
      log(`| ${short(p.id)} | ${p.q ?? "—"} | ${p.why} | ${res} |`);
    }
  }
  log();
  if (APPLY && !stop) {
    const touched = plans.filter((p) => p.plan.length).map((p) => short(p.fam));
    log(`Готово: исправлено ${fixed} из ${total}. Книгу пересобрать на /book/<токен> («Пересобрать»): семьи ${touched.join(", ") || "—"}.`);
  } else log(stop ? "Ничего не менял." : "Dry run: ничего не менял. Запустите с apply = true.");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.join("\n") + "\n");
  if (stop) process.exit(2);
}

type KkRow = { text: string | null; title: string | null; quote: string | null };
type TextRow = StoryTextRow & Pick<StoryText, "origin">;

/** #333: строки story_texts глав семьи (все языки) — одной загрузкой по 100 id; нет таблицы до migrate — пусто. */
async function textRows(ids: string[]): Promise<TextRow[]> {
  const out: TextRow[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const part = ids.slice(i, i + 100);
    try {
      out.push(...(await rest<TextRow[]>(`story_texts?select=story_id,lang,title,text,quote,origin&story_id=in.(${part.join(",")})`)));
    } catch {
      return [];
    }
  }
  return out;
}

/** #298: казахские переводы ИИ глав семьи (lang=kk, origin=ai, с текстом) — из уже загруженных строк. */
function kkRows(rows: readonly TextRow[]): Map<string, KkRow> {
  const out = new Map<string, KkRow>();
  for (const r of rows) if (r.lang === "kk" && r.origin === "ai" && r.text) out.set(r.story_id, { text: r.text, title: r.title, quote: r.quote });
  return out;
}

/** Сумма cost_usd OpenAI с начала суток UTC — тот же день, что daily_budget_usd в роутере. */
async function openaiSpentToday(): Promise<number | null> {
  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  try {
    let sum = 0;
    for (let offset = 0; ; offset += 1000) {
      const rows = await rest<{ cost_usd: number | null }[]>(
        `ai_usage?select=cost_usd&provider=eq.openai&created_at=gte.${day}&order=id.asc&limit=1000&offset=${offset}`,
      );
      sum += rows.reduce((n, r) => n + Number(r.cost_usd ?? 0), 0);
      if (rows.length < 1000) return sum;
    }
  } catch {
    return null;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
