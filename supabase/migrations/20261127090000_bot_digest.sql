-- #212: утренняя сводка бота в 09:00 Алматы без GitHub cron (он опаздывал на часы, #171).
-- 1) public.bot_digest_stats() — цифры для сводки одним вызовом (service_role через rpc): расход ИИ за вчера / сегодня /
--    месяц по окружениям (колонка ai_usage.env появится в #211; пока её нет — всё считается prod), бюджеты, зависшие
--    главы > 15 мин, новые семьи за сутки (только число), состояние задания bot-digest. Без текстов, имён и токенов.
-- 2) pg_cron 'bot-digest' каждый день 04:00 UTC (= 09:00 Алматы, UTC+5 круглый год) → pg_net POST /api/cron/digest
--    с «Authorization: Bearer CRON_SECRET». Секрет — тот же cron_secret из Vault, что у kick (#171). Адрес — секрет
--    digest_url, а если его нет — выводится из kick_url (…/api/cron/kick → …/api/cron/digest), руками ничего не нужно.
-- Без pg_cron / pg_net / Vault (PGlite в db:check) — только NOTICE. Новых таблиц нет — grant'ы service_role не нужны.

create or replace function public.bot_digest_stats(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  -- Алматы = UTC+5 без перевода часов: границы суток и месяца считаем сдвигом, без tzdata
  local_now timestamp := (p_now at time zone 'UTC') + interval '5 hours';
  today_start timestamptz := (date_trunc('day', local_now) - interval '5 hours') at time zone 'UTC';
  yesterday_start timestamptz := (date_trunc('day', local_now) - interval '1 day' - interval '5 hours') at time zone 'UTC';
  month_start timestamptz := (date_trunc('month', local_now) - interval '5 hours') at time zone 'UTC';
  has_env boolean;
  ai jsonb;
  budget jsonb;
  r jsonb;
begin
  has_env := exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'ai_usage' and column_name = 'env');
  execute format(
    'select coalesce(jsonb_object_agg(e, jsonb_build_object(''yesterday'', y, ''today'', t, ''month'', m)), ''{}''::jsonb)
       from (select %s as e,
                    round(coalesce(sum(cost_usd) filter (where created_at >= $1 and created_at < $2), 0), 4) as y,
                    round(coalesce(sum(cost_usd) filter (where created_at >= $2), 0), 4) as t,
                    round(coalesce(sum(cost_usd) filter (where created_at >= $3), 0), 4) as m
               from public.ai_usage
              where created_at >= least($1, $3)
              group by 1) x',
    case when has_env then 'coalesce(nullif(env, ''''), ''prod'')' else '''prod''' end)
  into ai using yesterday_start, today_start, month_start;

  select jsonb_build_object('day', sum(daily_budget_usd), 'month', sum(monthly_budget_usd))
    into budget from public.ai_providers where enabled;

  r := jsonb_build_object(
    'now', p_now,
    'env_column', has_env,
    'ai', ai,
    'budget', budget,
    'stuck', (select jsonb_build_object('count', count(*), 'oldest_min',
                       floor(extract(epoch from (p_now - min(updated_at))) / 60))
                from public.stories
               where status::text in ('uploaded', 'transcribing', 'editing', 'translating')
                 and updated_at < p_now - interval '15 minutes'),
    'new_families', (select count(*) from public.families
                      where created_at >= p_now - interval '24 hours' and not is_demo)
  );

  if to_regclass('cron.job') is not null then
    r := r || jsonb_build_object('cron', jsonb_build_object(
      'scheduled', exists (select 1 from cron.job where jobname = 'bot-digest' and active),
      'schedule', (select schedule from cron.job where jobname = 'bot-digest' limit 1),
      'last_run', (select jsonb_build_object('at', d.start_time, 'status', d.status)
                     from cron.job_run_details d join cron.job j on j.jobid = d.jobid
                    where j.jobname = 'bot-digest' order by d.start_time desc limit 1)));
  end if;
  return r;
end
$fn$;
revoke all on function public.bot_digest_stats(timestamptz) from public;
grant execute on function public.bot_digest_stats(timestamptz) to service_role;
do $do$
begin
  revoke all on function public.bot_digest_stats(timestamptz) from anon, authenticated;
exception when undefined_object then
  null;
end
$do$;

do $do$
begin
  begin
    create extension if not exists pg_cron with schema pg_catalog;
    create extension if not exists pg_net with schema extensions;
  exception when others then
    raise notice 'bot_digest: pg_cron / pg_net недоступны (%), задание не создано', sqlerrm;
    return;
  end;
  if to_regclass('vault.decrypted_secrets') is null then
    raise notice 'bot_digest: нет Supabase Vault, задание не создано';
    return;
  end if;

  begin
  perform cron.schedule(
    'bot-digest',
    '0 4 * * *',
    $job$
      select net.http_post(
        url := s.url,
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || s.secret),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000
      )
      from (
        select
          coalesce(
            (select decrypted_secret from vault.decrypted_secrets where name = 'digest_url'),
            (select regexp_replace(decrypted_secret, '/api/cron/kick/?$', '/api/cron/digest')
               from vault.decrypted_secrets where name = 'kick_url')) as url,
          (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret') as secret
      ) s
      where s.url like '%/api/cron/digest' and s.secret is not null;
    $job$
  );
  exception when others then
    raise warning 'bot_digest: задание не создано: %', sqlerrm;
  end;
end
$do$;
