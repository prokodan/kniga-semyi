// SQL для ai_routes из workflow ai-models (scripts/ai-models.mjs). Отдельный модуль — чтобы проверять тестом.
// #194: если Gemini в базе платный (ai_providers.gemini.paid = true, Tier 1 с 25.11), бесплатных квот 500 / 20
// больше нет — у моделей Gemini daily_limit / threshold не пишем. Решение принимает сама база в момент записи
// (case по ai_providers), скрипту доступ к базе не нужен.

/** Убирает квоты у моделей Gemini (платный уровень). */
export function withoutGeminiQuotas(list) {
  return list.map((e) => {
    if (e.provider !== "gemini") return e;
    const { daily_limit: _d, threshold: _t, ...rest } = e;
    void _d;
    void _t;
    return rest;
  });
}

const esc = (s) => s.replace(/'/g, "''");
const json = (list) => `'${esc(JSON.stringify(list))}'::jsonb`;

/** SQL: insert … on conflict для каждого шага; providers зависят от ai_providers.gemini.paid. */
export function routesSql(routes, timeouts) {
  const paid = "coalesce((select paid from ai_providers where provider = 'gemini'), false)";
  return [
    "-- Сгенерировано scripts/ai-models.mjs. Меняет только providers (порядок моделей); pinned_provider, timeout_ms и enabled не трогает.",
    "-- #194: Gemini платный (ai_providers.paid) → у моделей Gemini без daily_limit / threshold.",
    "begin;",
    ...Object.entries(routes).map(
      ([step, list]) =>
        `insert into ai_routes (step, providers, timeout_ms) values ('${step}', case when ${paid} then ${json(withoutGeminiQuotas(list))} else ${json(list)} end, ${timeouts[step]})\n  on conflict (step) do update set providers = excluded.providers, updated_at = now();`,
    ),
    "commit;",
    "select step, jsonb_path_query_array(providers, '$[*].model') as models from ai_routes order by step;",
  ].join("\n");
}
