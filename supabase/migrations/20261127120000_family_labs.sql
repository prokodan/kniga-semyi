-- #223: выкатка флагов функций по семьям. Имя флага в labs → флаг включён этой семье, даже если в Production выключен.
-- Только добавляет колонку с пустым значением по умолчанию: поведение существующих семей не меняется.
-- Таблица families уже есть и у service_role на неё права (20261122120000) — новый grant не нужен.
alter table public.families add column if not exists labs text[] not null default '{}';

comment on column public.families.labs is
  'Флаги функций (#223), включённые этой семье до общей выкатки: имена из lib/flags/registry.ts. Меняет /admin/families.';
