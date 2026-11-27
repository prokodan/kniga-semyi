-- #211: тестовое окружение (Supabase staging для превью). Ключи ИИ одни на прод и превью → бюджеты общие.
-- ai_usage.env — откуда вызов: 'prod' (сам прод) или 'staging' (превью прислало строку в прод через
-- POST /api/ai/usage, а в базе staging — его собственные строки). Только добавляем: старые строки = 'prod',
-- прод без новых переменных пишет как раньше (колонку не передаёт — сработает default).
-- Роутер считает бюджет по всем строкам (prod + staging); /admin/ai и bot_digest_stats() делят расход по env.
-- Новых таблиц нет — grant'ы service_role не нужны.

alter table public.ai_usage add column if not exists env text not null default 'prod';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ai_usage_env_check' and conrelid = 'public.ai_usage'::regclass
  ) then
    alter table public.ai_usage add constraint ai_usage_env_check check (env in ('prod', 'staging'));
  end if;
end $$;
