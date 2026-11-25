-- #171: таймер подстраховки конвейера без GitHub cron. GitHub запускал kick-stuck «*/10» по факту раз в 8–12 ч.
-- Supabase pg_cron раз в 5 мин → pg_net POST на /api/cron/kick с секретом в заголовке Authorization.
-- Адрес и секрет — не в репозитории, а в Supabase Vault (Dashboard → SQL Editor, один раз):
--   select vault.create_secret('<тот же CRON_SECRET, что в Vercel>', 'cron_secret');
--   select vault.create_secret('https://kniga-semyi.vercel.app/api/cron/kick', 'kick_url');
-- Пока секретов в Vault нет, задание ничего не делает. Если pg_cron / pg_net / Vault недоступны (PGlite в db:check,
-- другой Postgres) — миграция только пишет NOTICE: тогда таймер — внешний (cron-job.org), см. PR #171.
-- Новых таблиц в public нет — grant'ы service_role не нужны.
do $do$
begin
  begin
    create extension if not exists pg_cron with schema pg_catalog;
    create extension if not exists pg_net with schema extensions;
  exception when others then
    raise notice 'cron_kick: pg_cron / pg_net недоступны (%), таймер не создан', sqlerrm;
    return;
  end;
  if to_regclass('vault.decrypted_secrets') is null then
    raise notice 'cron_kick: нет Supabase Vault, таймер не создан';
    return;
  end if;

  begin
  -- cron.schedule с именем — создаёт или обновляет задание (повторный прогон миграции безопасен)
  perform cron.schedule(
    'kick-stuck',
    '*/5 * * * *',
    $job$
      select net.http_post(
        url := s.url,
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || s.secret),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000
      )
      from (
        select
          (select decrypted_secret from vault.decrypted_secrets where name = 'kick_url') as url,
          (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret') as secret
      ) s
      where s.url is not null and s.secret is not null;
    $job$
  );

  -- История запусков pg_cron растёт на 288 строк в день — держим 3 дня
  perform cron.schedule(
    'cron-history-cleanup',
    '17 3 * * *',
    $job$ delete from cron.job_run_details where end_time < now() - interval '3 days'; $job$
  );
  exception when others then
    -- не роняем migrate (за ней — другие миграции); состояние видно в public.cron_kick_status()
    raise warning 'cron_kick: задание не создано: %', sqlerrm;
  end;
end
$do$;

-- Состояние таймера для health / diag (service_role через rpc): есть ли задание, последний запуск и ответ ручки.
-- Без значений секретов — только «заданы ли».
create or replace function public.cron_kick_status() returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  r jsonb := jsonb_build_object('pg_cron', to_regclass('cron.job') is not null);
begin
  if to_regclass('cron.job') is not null then
    r := r || jsonb_build_object(
      'scheduled', exists (select 1 from cron.job where jobname = 'kick-stuck' and active),
      'last_run', (select jsonb_build_object('at', d.start_time, 'status', d.status)
                     from cron.job_run_details d join cron.job j on j.jobid = d.jobid
                    where j.jobname = 'kick-stuck' order by d.start_time desc limit 1));
  end if;
  if to_regclass('vault.decrypted_secrets') is not null then
    r := r || jsonb_build_object(
      'secrets', (select jsonb_build_object(
                    'kick_url', bool_or(name = 'kick_url'), 'cron_secret', bool_or(name = 'cron_secret'))
                  from vault.decrypted_secrets where name in ('kick_url', 'cron_secret')));
  end if;
  if to_regclass('net._http_response') is not null then
    r := r || jsonb_build_object(
      'last_http', (select jsonb_build_object('at', h.created, 'code', h.status_code, 'timed_out', h.timed_out)
                      from net._http_response h order by h.created desc limit 1));
  end if;
  return r;
end
$fn$;
revoke all on function public.cron_kick_status() from public;
grant execute on function public.cron_kick_status() to service_role;
-- В Supabase у anon / authenticated есть права по умолчанию на новые функции public — снимаем (в PGlite этих ролей нет)
do $do$
begin
  revoke all on function public.cron_kick_status() from anon, authenticated;
exception when undefined_object then
  null;
end
$do$;
