-- I11: шаги оценки качества (только eval / CI): judge — LLM-судья голоса 1–5,
-- back_translate — обратный перевод KR→RU другой моделью с флажками сомнительных мест.
-- Новых таблиц нет — grant'ы service_role не нужны. Должно совпадать с DEFAULT_ROUTES в lib/ai/config.ts.
insert into ai_routes (step, providers, timeout_ms) values
  ('judge', '[{"provider":"gemini","model":"gemini-2.5-flash-lite","daily_limit":500,"threshold":0.9},{"provider":"openai","model":"gpt-5-mini"}]', 40000),
  ('back_translate', '[{"provider":"gemini","model":"gemini-2.5-flash","daily_limit":20,"threshold":0.9},{"provider":"openai","model":"gpt-5-mini"},{"provider":"gemini","model":"gemini-2.5-flash-lite","daily_limit":500,"threshold":0.9}]', 60000)
on conflict (step) do nothing;
