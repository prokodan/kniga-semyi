// #352 (docs/v2/QUALITY_LOOP.md §5.1): джоб quality-run — только staging.
//   QUALITY_ACTION=seed — сид банка: eval/quality/seed.<пара>.json + eval-персонажи (eval/personas) → quality_personas /
//     quality_texts (повторный сид ничего не дублирует и не трогает архив). Без ИИ.
//   QUALITY_ACTION=run — прогон активных (не архивных) личностей и текстов пары боевым конвейером: роутер ИИ с маршрутами
//     и провайдерами из базы staging (ai_routes / ai_providers), промпты prompts/* этого коммита, правки без ИИ как у семьи.
//     В каждом прогоне — commit_sha, хэши prompts/*, маршруты шагов и кто ответил → quality_runs / quality_items.
// Лимиты $: QUALITY_LIMIT_USD на запуск (по умолчанию 2) и QUALITY_DAILY_USD на сутки UTC по всем прогонам (5).
// В лог и Summary — только id, названия событий и числа; тексты — в базе staging.
import { appendFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createRouter } from "@/lib/ai/router";
import { SupabaseStore } from "@/lib/ai/store";
import { getAiMode } from "@/lib/env";
import { SupabaseQualityRepo } from "@/lib/quality/repo";
import { RUN_STEPS, guardedAi, runPersona, runText, trackingStore, type RunOutcome } from "@/lib/quality/run";
import { loadSeedFiles, promptVersions, seedRows } from "@/lib/quality/seed";
import { isQualityPair, PAIR_RU, type QualityPair } from "@/lib/quality/types";

const SB = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TARGET = process.env.QUALITY_TARGET ?? "";
const ACTION = process.env.QUALITY_ACTION === "seed" ? "seed" : "run";
const PAIR = process.env.QUALITY_PAIR ?? "ru-kk";
const KIND = ["persona", "text"].includes(process.env.QUALITY_KIND ?? "") ? process.env.QUALITY_KIND! : "all";
const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
const LIMIT_USD = num(process.env.QUALITY_LIMIT_USD, 2);
const DAILY_USD = num(process.env.QUALITY_DAILY_USD, 5);
const MAX_ITEMS = num(process.env.QUALITY_MAX_ITEMS, 40);
const QUESTIONS = num(process.env.QUALITY_QUESTIONS, 3);
const NO_CACHE = process.env.QUALITY_NO_CACHE === "1";
const IDS = (process.env.QUALITY_IDS ?? "").split(",").map((s) => s.trim()).filter((s) => /^[0-9a-f-]{8,36}$/i.test(s));
const COMMIT = process.env.GITHUB_SHA ?? null;
const BATCH = process.env.GITHUB_RUN_ID ?? null;

const out: string[] = [];
const log = (l = "") => {
  console.log(l);
  out.push(l);
};
function summary() {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (f) appendFileSync(f, out.join("\n") + "\n");
}

async function main() {
  // Только staging: прод семей не трогаем никогда (§6). Workflow передаёт только секреты STAGING_*.
  if (TARGET !== "staging") throw new Error("quality-run работает только на staging (QUALITY_TARGET=staging)");
  if (!SB || !KEY) throw new Error("Нужны NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY базы staging");
  const db = createClient(SB, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const repo = new SupabaseQualityRepo(db);

  if (ACTION === "seed") {
    const rows = seedRows(loadSeedFiles());
    const r = await repo.upsertSeed(rows.personas, rows.texts);
    log(`### quality-run: сид банка (staging)`);
    log("");
    log(`В сиде: личностей ${rows.personas.length}, текстов ${rows.texts.length}. Добавлено новых: личностей **${r.personas}**, текстов **${r.texts}** (остальные уже были — не тронуты).`);
    return;
  }

  if (!isQualityPair(PAIR)) throw new Error(`Неизвестная пара ${PAIR}`);
  const pair: QualityPair = PAIR;
  const dayStart = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const spentToday = await repo.runSpendSince(dayStart);
  const tracked = trackingStore(new SupabaseStore(db, "staging"));
  const router = createRouter({ store: tracked.store });
  // лимит запуска и остаток суточного — что раньше кончится
  const limit = Math.max(0, Math.min(LIMIT_USD, DAILY_USD - spentToday));
  const ai = guardedAi(router, tracked.cost, limit, NO_CACHE ? { noCache: true } : {});

  const routes: Record<string, string[]> = {};
  for (const step of RUN_STEPS) routes[step] = (await tracked.store.getRoute(step)).providers.map((p) => `${p.provider}/${p.model}`);
  const versions = promptVersions();

  const [personas, texts] = await Promise.all([repo.personas(pair), repo.texts(pair)]);
  const pick = <T extends { id: string; status: string }>(xs: T[]) => xs.filter((x) => x.status !== "archived" && (!IDS.length || IDS.some((id) => x.id.startsWith(id))));
  const queue = [
    ...(KIND === "persona" ? [] : pick(texts).map((t) => ({ kind: "text" as const, t }))),
    ...(KIND === "text" ? [] : pick(personas).map((p) => ({ kind: "persona" as const, p }))),
  ].slice(0, MAX_ITEMS);

  log(`### quality-run: ${PAIR_RU[pair]} (staging)`);
  log("");
  log(`Режим ИИ **${getAiMode()}** · коммит \`${COMMIT?.slice(0, 7) ?? "—"}\` · лимит запуска $${LIMIT_USD} · за сутки уже $${spentToday.toFixed(2)} из $${DAILY_USD} → доступно **$${limit.toFixed(2)}** · в очереди ${queue.length} (тексты, потом личности)`);
  log("");
  if (getAiMode() === "mock") log("⚠️ AI_MODE=mock — нет ключей ИИ, прогон заглушкой (результат не показателен).");
  if (limit <= 0) {
    log("🔴 Суточный лимит прогонов исчерпан — ничего не запускаем.");
    return;
  }
  log("| # | что | статус | items | вызовов | $ | translate |");
  log("| --- | --- | --- | --- | --- | --- | --- |");

  let n = 0;
  const totals = { ok: 0, partial: 0, budget: 0, error: 0, items: 0 };
  for (const q of queue) {
    n += 1;
    const before = tracked.cost();
    tracked.resetUsed();
    let res: RunOutcome;
    try {
      res = q.kind === "text" ? await runText(q.t, pair, ai) : await runPersona(q.p, pair, ai, { maxQuestions: QUESTIONS, maxCalls: 30 });
    } catch (e) {
      res = { status: "error", items: [], error: (e as Error).message.slice(0, 300) };
    }
    const cost = Math.round((tracked.cost() - before) * 10_000) / 10_000;
    const ref = q.kind === "text" ? q.t : q.p;
    await repo.addRun(
      {
        kind: q.kind,
        ref_id: ref.id,
        pair,
        commit_sha: COMMIT,
        prompt_versions: versions,
        models: { routes, used: tracked.used() },
        env: "staging",
        status: res.status,
        calls: tracked.calls(),
        cost_usd: cost,
        error: res.error,
        batch: BATCH,
      },
      res.items,
    );
    if (res.items.length) await repo.setStatus(q.kind, [ref.id], "active", "new");
    totals[res.status] += 1;
    totals.items += res.items.length;
    const label = q.kind === "text" ? `текст: ${q.t.event.slice(0, 50)}` : `личность: ${q.p.name}`;
    log(`| ${n} | ${label} | ${res.status} | ${res.items.length} | ${tracked.calls()} | ${cost.toFixed(4)} | ${(tracked.used().translate ?? []).join(", ") || "—"} |`);
    if (res.status === "budget" || tracked.cost() >= limit) {
      log("");
      log(`🟡 Лимит $${limit.toFixed(2)} исчерпан — остальное в следующий запуск.`);
      break;
    }
  }
  log("");
  log(`Итог: готово ${totals.ok}, частично ${totals.partial}, лимит ${totals.budget}, ошибка ${totals.error}; items **${totals.items}**; потрачено **$${tracked.cost().toFixed(4)}**.`);
  log("");
  log(`Промпты: ${Object.entries(versions).map(([f, v]) => `${f} ${v}`).join(" · ")}`);
  log("");
  log(`Маршруты: ${Object.entries(routes).map(([s, r]) => `${s}: ${r.join(" → ")}`).join(" · ")}`);
  if (totals.items === 0 && queue.length > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    log(`🔴 ${(e as Error).message}`);
    process.exitCode = 1;
  })
  .finally(summary);
