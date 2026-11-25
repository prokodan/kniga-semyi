-- Восстановление ai_routes после запуска ai-models 25.11 ~17:47 UTC: квота Gemini была исчерпана (gemini-3.5-flash-lite
-- и gemini-3.6-flash отвечали 429), скрипт счёл их нерабочими и записал gemini-3.1-flash-lite → gpt-5.4-mini без Flash,
-- а в transcribe поставил gemini-3.5-transcribe (решено — только после питча, #52). Возвращаем порядок прогона 22.11
-- (последний проверенный) + изменения #178 / #105: резерв gpt-5.4-mini, completeness / next_question с Flash вторым.
-- Таймауты не меняем (completeness / next_question — 7 с из 20261125210000). Квоты — как в ai-models: 500 / 20.
-- Новых таблиц нет.
update ai_routes set updated_at = now(), providers = case step
  when 'transcribe' then
    '[{"provider":"gemini","model":"gemini-3.5-flash-lite","daily_limit":500,"threshold":0.9},{"provider":"gemini","model":"gemini-3.6-flash","daily_limit":20,"threshold":0.9},{"provider":"openai","model":"gpt-4o-transcribe"}]'::jsonb
  when 'persona_reply' then
    '[{"provider":"gemini","model":"gemini-3.5-flash-lite","daily_limit":500,"threshold":0.9},{"provider":"openai","model":"gpt-5.4-mini"}]'::jsonb
  when 'judge' then
    '[{"provider":"gemini","model":"gemini-3.5-flash-lite","daily_limit":500,"threshold":0.9},{"provider":"openai","model":"gpt-5.4-mini"}]'::jsonb
  when 'back_translate' then
    '[{"provider":"gemini","model":"gemini-3.6-flash","daily_limit":20,"threshold":0.9},{"provider":"openai","model":"gpt-5.4-mini"},{"provider":"gemini","model":"gemini-3.5-flash-lite","daily_limit":500,"threshold":0.9}]'::jsonb
  else
    -- edit, translate, tale, completeness, next_question
    '[{"provider":"gemini","model":"gemini-3.5-flash-lite","daily_limit":500,"threshold":0.9},{"provider":"gemini","model":"gemini-3.6-flash","daily_limit":20,"threshold":0.9},{"provider":"openai","model":"gpt-5.4-mini"}]'::jsonb
  end
where step in ('transcribe', 'edit', 'translate', 'tale', 'completeness', 'next_question', 'persona_reply', 'judge', 'back_translate')
  -- только база, которую уже вёл ai-models (прод); новую базу (e2e, PGlite) с моделями 2.5 по умолчанию не трогаем
  and exists (select 1 from ai_routes r, jsonb_array_elements(r.providers) e where e->>'model' like 'gemini-3%');
