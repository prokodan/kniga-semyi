-- Картинки сказки: OpenAI снял gpt-image-1 — seed-demo 23.11 получил HTTP 400 «The model 'gpt-image-1' does not exist»,
-- поэтому «Художник сейчас занят» и пустые картинки. Новый маршрут: gpt-image-2 → резерв gpt-image-1.5.
-- Таймаут 45 с — меньше лимита функции Vercel (60 с), чтобы сказка успела поставить картинку из набора.
-- Должно совпадать с lib/ai/config.ts (DEFAULT_ROUTES.illustrate). Новых таблиц нет.
insert into ai_routes (step, providers, timeout_ms) values
  ('illustrate', '[{"provider":"openai","model":"gpt-image-2"},{"provider":"openai","model":"gpt-image-1.5"}]', 45000)
on conflict (step) do update set providers = excluded.providers, timeout_ms = excluded.timeout_ms;
