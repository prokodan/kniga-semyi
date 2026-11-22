-- I16: бот-пульт команды в Telegram.
-- bot_users — кто из команды пишет боту (личка разрешена только им), роль определяет шаблон промпта.
-- bot_settings — настройки уведомлений чата (группы TELEGRAM_CHAT_ID), prefs: { ci_failed: true, ... }.
-- Доступ только с сервера (service-ключ), RLS включён без политик — как у остальных таблиц.

create table bot_users (
  tg_id bigint primary key,
  name text not null,
  github_login text,
  role text check (role in ('danil', 'vlad')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table bot_settings (
  chat_id bigint primary key,
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table bot_users enable row level security;
alter table bot_settings enable row level security;

grant all on table bot_users to service_role;
grant all on table bot_settings to service_role;
