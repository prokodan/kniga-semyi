-- #56: защита PIN админки и кабинета АКНЦ от перебора — не больше 5 неверных попыток за 10 минут с одного IP.
-- Храним только хэш IP (sha256 с солью из ADMIN_PIN на сервере), сам IP и введённый PIN не пишем.
-- Доступ только с сервера (service-ключ), RLS включён без политик — как у остальных таблиц.

create table pin_attempts (
  id bigint generated always as identity primary key,
  scope text not null,              -- 'admin' (вход /admin/ai, /admin и /center — один ADMIN_PIN)
  ip_hash text not null,
  created_at timestamptz not null default now()
);

create index pin_attempts_scope_ip_time_idx on pin_attempts(scope, ip_hash, created_at desc);

alter table pin_attempts enable row level security;

grant all on table pin_attempts to service_role;
grant all on sequence pin_attempts_id_seq to service_role;
