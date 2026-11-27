// #222: настройки ИИ staging = прод. Копирует ai_routes и ai_providers из боевой базы в kniga-semyi-staging.
// Запуск — workflows seed-demo (target=staging) и staging-sync; локально:
//   PROD_SB_URL=… PROD_SB_KEY=… STG_SB_URL=… STG_SB_KEY=… [STAGING_AI_BUDGETS=gemini=5/10,openai=2/5] node scripts/ai-config-sync.mjs
// Без зависимостей (PostgREST через fetch) — workflow не ставит npm ci. ai-models в staging не запускается.
//
// Что копируется: маршруты целиком (порядок моделей, квоты, таймаут, закрепление, вкл / выкл); у провайдеров —
// enabled, paid (#244: Gemini платный → расход превью не $0), cooldown_minutes.
// Бюджеты staging свои (#218: у превью свои ключи ИИ):
//   STAGING_AI_BUDGETS = "gemini=5/10,openai=2/5" ($/день / $/мес; «-» = без лимита) — задать явно;
//   STAGING_AI_BUDGETS = "same" — как в проде;
//   не задано — бюджеты staging не трогаем, а если строки провайдера в staging нет — как в проде.
// Шаги, которых нет в проде, в staging не удаляются (только сообщение).

const ROUTE_COLUMNS = ["step", "providers", "pinned_provider", "timeout_ms", "enabled"];
const PROVIDER_COLUMNS = ["provider", "enabled", "paid", "daily_budget_usd", "monthly_budget_usd", "cooldown_minutes"];

/** "gemini=5/10,openai=2/-" → { gemini: { daily: 5, monthly: 10 }, openai: { daily: 2, monthly: null } }; "same" → "same"; пусто → null */
export function parseBudgets(input) {
  const text = (input ?? "").trim();
  if (!text) return null;
  if (text.toLowerCase() === "same") return "same";
  const out = {};
  for (const part of text.split(",")) {
    const item = part.trim();
    if (!item) continue;
    const m = /^([a-z0-9_-]+)\s*=\s*([0-9.]+|-)\s*\/\s*([0-9.]+|-)$/i.exec(item);
    if (!m) throw new Error(`STAGING_AI_BUDGETS: не понял «${item}» — нужно провайдер=день/месяц, например gemini=5/10`);
    const num = (v) => (v === "-" ? null : Number(v));
    const daily = num(m[2]);
    const monthly = num(m[3]);
    if ((daily !== null && !Number.isFinite(daily)) || (monthly !== null && !Number.isFinite(monthly))) {
      throw new Error(`STAGING_AI_BUDGETS: не число в «${item}»`);
    }
    out[m[1].toLowerCase()] = { daily, monthly };
  }
  return out;
}

const pick = (row, columns) => Object.fromEntries(columns.map((c) => [c, row[c] ?? null]));

/** Что записать в staging. Чистая функция — тест scripts/ai-config-sync.test.ts. */
export function planStagingConfig({ prodRoutes, prodProviders, stagingProviders, stagingSteps = [], budgets = null }) {
  if (!prodRoutes.length) throw new Error("в проде нет ai_routes — копировать нечего (staging не трогаю)");
  const routes = prodRoutes.map((r) => ({ ...pick(r, ROUTE_COLUMNS), enabled: r.enabled ?? true }));
  const own = new Map(stagingProviders.map((p) => [p.provider, p]));
  const providers = prodProviders.map((p) => {
    const base = pick(p, PROVIDER_COLUMNS);
    const explicit = budgets && budgets !== "same" ? budgets[p.provider] : undefined;
    let daily = base.daily_budget_usd;
    let monthly = base.monthly_budget_usd;
    let budgetFrom = "prod";
    if (explicit) {
      daily = explicit.daily;
      monthly = explicit.monthly;
      budgetFrom = "input";
    } else if (budgets !== "same" && own.has(p.provider)) {
      daily = own.get(p.provider).daily_budget_usd ?? null;
      monthly = own.get(p.provider).monthly_budget_usd ?? null;
      budgetFrom = "staging";
    }
    const row = {
      ...base,
      enabled: base.enabled ?? true,
      paid: base.paid ?? false,
      cooldown_minutes: base.cooldown_minutes ?? 10,
      daily_budget_usd: daily,
      monthly_budget_usd: monthly,
    };
    return { row, budgetFrom };
  });
  const prodSteps = new Set(prodRoutes.map((r) => r.step));
  const extraSteps = stagingSteps.filter((s) => !prodSteps.has(s));
  return { routes, providers: providers.map((p) => p.row), budgetFrom: providers, extraSteps };
}

/** Короткий отчёт в markdown (summary workflow). */
export function reportMarkdown(plan) {
  const models = (list) =>
    Array.isArray(list) ? list.map((e) => `${e.provider}:${e.model}`).join(" → ") : "—";
  const usd = (v) => (v === null || v === undefined ? "без лимита" : `$${Number(v)}`);
  const from = { prod: "как в проде", staging: "свой (staging)", input: "из входа / переменной" };
  return [
    "### Настройки ИИ staging = прод (#222)",
    "",
    "| Шаг | Модели | Таймаут | Закреплён |",
    "| --- | --- | --- | --- |",
    ...plan.routes.map(
      (r) => `| ${r.step}${r.enabled ? "" : " (выкл)"} | ${models(r.providers)} | ${r.timeout_ms ?? "—"} мс | ${r.pinned_provider ?? "—"} |`,
    ),
    "",
    "| Провайдер | Вкл | Платный | Бюджет день / месяц | Откуда бюджет |",
    "| --- | --- | --- | --- | --- |",
    ...plan.budgetFrom.map(
      ({ row, budgetFrom }) =>
        `| ${row.provider} | ${row.enabled ? "да" : "нет"} | ${row.paid ? "да" : "нет"} | ${usd(row.daily_budget_usd)} / ${usd(row.monthly_budget_usd)} | ${from[budgetFrom]} |`,
    ),
    ...(plan.extraSteps.length ? ["", `Шаги только в staging (не удалены): ${plan.extraSteps.join(", ")}`] : []),
  ].join("\n");
}

// ---------------- запуск ----------------

function client(url, key) {
  const base = `${url.replace(/\/+$/, "")}/rest/v1`;
  const headers = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };
  return {
    async select(table, columns) {
      const res = await fetch(`${base}/${table}?select=${columns.join(",")}`, { headers });
      if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      return res.json();
    },
    async upsert(table, key, rows) {
      const res = await fetch(`${base}/${table}?on_conflict=${key}`, {
        method: "POST",
        headers: { ...headers, prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(rows),
      });
      if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    },
  };
}

const refOf = (url) => /^https?:\/\/([^./]+)/.exec(url ?? "")?.[1] ?? "";

async function main() {
  const { PROD_SB_URL, PROD_SB_KEY, STG_SB_URL, STG_SB_KEY, STAGING_AI_BUDGETS } = process.env;
  if (!PROD_SB_URL || !PROD_SB_KEY || !STG_SB_URL || !STG_SB_KEY) {
    throw new Error("нужны PROD_SB_URL, PROD_SB_KEY (прод) и STG_SB_URL, STG_SB_KEY (staging)");
  }
  if (refOf(PROD_SB_URL) === refOf(STG_SB_URL)) throw new Error("staging и прод — одна и та же база, копировать некуда");
  const prod = client(PROD_SB_URL, PROD_SB_KEY);
  const stg = client(STG_SB_URL, STG_SB_KEY);
  const [prodRoutes, prodProviders, stagingProviders, stagingRoutes] = await Promise.all([
    prod.select("ai_routes", ROUTE_COLUMNS),
    prod.select("ai_providers", PROVIDER_COLUMNS),
    stg.select("ai_providers", PROVIDER_COLUMNS),
    stg.select("ai_routes", ["step"]),
  ]);
  const plan = planStagingConfig({
    prodRoutes,
    prodProviders,
    stagingProviders,
    stagingSteps: stagingRoutes.map((r) => r.step),
    budgets: parseBudgets(STAGING_AI_BUDGETS),
  });
  await stg.upsert("ai_providers", "provider", plan.providers);
  await stg.upsert("ai_routes", "step", plan.routes);
  const md = reportMarkdown(plan);
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
  }
}

import { pathToFileURL } from "node:url";

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((e) => {
    console.error(`::error::ai-config-sync: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
}
