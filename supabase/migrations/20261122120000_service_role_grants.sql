-- Хотфикс: права для service_role на схему public.
-- В новом проекте Supabase таблицы из init-миграции не получили grant'ов, и сервер (service-ключ)
-- ловил «permission denied» → /api/health отдавал db: "error".
-- На проде уже выполнено вручную в SQL Editor, поэтому миграция идемпотентна: GRANT и
-- ALTER DEFAULT PRIVILEGES можно повторять сколько угодно — второй запуск ничего не меняет.
-- Обёртка DO нужна для PGlite (npm run db:check), где роли service_role может не быть.
-- Правило на будущее (AGENTS.md): каждая новая таблица в миграции — сразу grant для service_role.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema public to service_role;
    grant all on all tables in schema public to service_role;
    grant all on all sequences in schema public to service_role;
    -- для таблиц и последовательностей, которые будущие миграции создадут от этого же владельца
    alter default privileges in schema public grant all on tables to service_role;
    alter default privileges in schema public grant all on sequences to service_role;
  else
    raise notice 'роль service_role не найдена — grant''ы пропущены (локальная проверка)';
  end if;
end;
$$;
