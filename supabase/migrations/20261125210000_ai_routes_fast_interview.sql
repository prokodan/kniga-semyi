-- #178 + #105 (п. 4): быстрый ответ интервью и новый платный резерв.
-- 1. Везде gpt-5-mini (OpenAI помечает устаревающим) → gpt-5.4-mini.
-- 2. completeness / next_question: Flash-Lite → gemini-3.6-flash → gpt-5.4-mini, таймаут модели 7 с (было 12 с и
--    gpt-5-mini вторым: медиана 8 с, ответ интервью при отказе Flash-Lite ждал ~10–20 с — diag 25.11, #167).
-- Первую модель маршрута (Flash-Lite, её выбрал ai-models) не трогаем. Flash (с квотой) берём ту же, что в маршруте
-- edit (в проде её выбрал ai-models — gemini-3.6-flash), иначе — gemini-3.6-flash с квотой 20. Повтор ничего не дублирует.
-- Должно совпадать с lib/ai/config.ts (DEFAULT_ROUTES) и scripts/ai-models.mjs. Новых таблиц нет.

-- 1. gpt-5-mini → gpt-5.4-mini во всех маршрутах
update ai_routes r
set providers = (
      select jsonb_agg(
               case when e->>'model' = 'gpt-5-mini' then jsonb_set(e, '{model}', '"gpt-5.4-mini"') else e end
               order by i)
      from jsonb_array_elements(r.providers) with ordinality as x(e, i)
    ),
    updated_at = now()
where r.providers @> '[{"model":"gpt-5-mini"}]';

-- 2. completeness / next_question: [первая, Flash, остальные без Flash], таймаут 7 с
with flash as (
  select coalesce(
           (select e from ai_routes, jsonb_array_elements(providers) e
             where step = 'edit' and e->>'provider' = 'gemini' and e->>'model' like '%flash%'
               and e->>'model' not like '%lite%' limit 1),
           '{"provider":"gemini","model":"gemini-3.6-flash","daily_limit":20,"threshold":0.9}'::jsonb
         ) as e
)
update ai_routes r
set providers = jsonb_build_array(r.providers->0)
              || jsonb_build_array((select e from flash))
              || coalesce((
                   select jsonb_agg(e order by i)
                   from jsonb_array_elements(r.providers) with ordinality as x(e, i)
                   where i > 1 and e <> (select e from flash)
                 ), '[]'::jsonb),
    timeout_ms = 7000,
    updated_at = now()
where r.step in ('completeness', 'next_question')
  and jsonb_array_length(r.providers) > 0
  and r.providers->0 <> (select e from flash);

-- Строк маршрутов ещё нет (новая база) — значения по умолчанию, как DEFAULT_ROUTES в lib/ai/config.ts
-- (config.test сверяет последнюю строку каждого шага в миграциях с кодом). Существующие строки не меняются.
insert into ai_routes (step, providers, timeout_ms) values
  ('edit', '[{"provider":"gemini","model":"gemini-2.5-flash-lite","daily_limit":500,"threshold":0.9},{"provider":"gemini","model":"gemini-2.5-flash","daily_limit":20,"threshold":0.9},{"provider":"openai","model":"gpt-5.4-mini"}]', 30000),
  ('translate', '[{"provider":"gemini","model":"gemini-2.5-flash-lite","daily_limit":500,"threshold":0.9},{"provider":"gemini","model":"gemini-2.5-flash","daily_limit":20,"threshold":0.9},{"provider":"openai","model":"gpt-5.4-mini"}]', 30000),
  ('completeness', '[{"provider":"gemini","model":"gemini-2.5-flash-lite","daily_limit":500,"threshold":0.9},{"provider":"gemini","model":"gemini-2.5-flash","daily_limit":20,"threshold":0.9},{"provider":"openai","model":"gpt-5.4-mini"}]', 7000),
  ('next_question', '[{"provider":"gemini","model":"gemini-2.5-flash-lite","daily_limit":500,"threshold":0.9},{"provider":"gemini","model":"gemini-2.5-flash","daily_limit":20,"threshold":0.9},{"provider":"openai","model":"gpt-5.4-mini"}]', 7000),
  ('tale', '[{"provider":"gemini","model":"gemini-2.5-flash-lite","daily_limit":500,"threshold":0.9},{"provider":"gemini","model":"gemini-2.5-flash","daily_limit":20,"threshold":0.9},{"provider":"openai","model":"gpt-5.4-mini"}]', 40000),
  ('persona_reply', '[{"provider":"gemini","model":"gemini-2.5-flash-lite","daily_limit":500,"threshold":0.9},{"provider":"openai","model":"gpt-5.4-mini"}]', 20000),
  ('judge', '[{"provider":"gemini","model":"gemini-2.5-flash-lite","daily_limit":500,"threshold":0.9},{"provider":"openai","model":"gpt-5.4-mini"}]', 40000),
  ('back_translate', '[{"provider":"gemini","model":"gemini-2.5-flash","daily_limit":20,"threshold":0.9},{"provider":"openai","model":"gpt-5.4-mini"},{"provider":"gemini","model":"gemini-2.5-flash-lite","daily_limit":500,"threshold":0.9}]', 60000)
on conflict (step) do nothing;
