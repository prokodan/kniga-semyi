-- W0: начальная схема «Книги семьи».
-- Правило: миграции только ДОБАВЛЯЮТ (новые таблицы, колонки, значения enum). Старые файлы не редактируем.
-- Применяются workflow .github/workflows/migrate.yml при слиянии в main.
-- RLS включён везде без политик: anon-ключ не видит ничего, сервер ходит с service_role.

-- ---------- enums ----------
create type story_status as enum ('uploaded', 'transcribing', 'editing', 'translating', 'ready', 'failed');
create type book_status as enum ('draft', 'building', 'ready', 'failed');
create type session_mode as enum ('family', 'kiosk');
create type demo_order_status as enum ('created', 'paid_demo', 'cancelled');

-- ---------- updated_at ----------
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- семьи ----------
create table families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- вход семьи по ссылке /f/<access_token>, без регистрации
  access_token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  gift_date date,
  source session_mode not null default 'family',
  contact text,
  -- отдельная галочка: можно ли передать истории в архив АКНЦ
  archive_consent boolean not null default false,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger families_updated_at before update on families for each row execute function set_updated_at();

create table kiosk_volunteers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table storytellers (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  name text not null,
  name_ko text,
  birth_year int,
  death_year int,
  birth_place text,
  photo_url text,
  -- голосовое согласие: обязательный шаг до первой записи
  consent_audio_url text,
  consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index storytellers_family_idx on storytellers(family_id);
create trigger storytellers_updated_at before update on storytellers for each row execute function set_updated_at();

create table sessions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  storyteller_id uuid not null references storytellers(id) on delete cascade,
  mode session_mode not null default 'family',
  volunteer_id uuid references kiosk_volunteers(id) on delete set null,
  -- состояние интервью-агента: закрытые блоки, текущий вопрос, число уточнений
  state jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index sessions_family_idx on sessions(family_id);
create index sessions_started_idx on sessions(started_at);

create table stories (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  storyteller_id uuid not null references storytellers(id) on delete cascade,
  session_id uuid references sessions(id) on delete set null,
  question_id text,
  block text,                       -- блок карты жизни (content/questions/blocks.ts)
  audio_url text,
  duration_sec numeric(8, 2),
  transcript text,
  text_ru text,
  text_ko text,
  title text,
  title_ko text,
  quote text,
  quote_ko text,
  facts jsonb not null default '[]'::jsonb,
  followups jsonb not null default '[]'::jsonb, -- уточнения интервью-агента: [{question, answer}]
  status story_status not null default 'uploaded',
  error text,
  sort_order int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index stories_family_idx on stories(family_id);
create index stories_storyteller_idx on stories(storyteller_id);
create index stories_status_idx on stories(status);
create trigger stories_updated_at before update on stories for each row execute function set_updated_at();

create table books (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  status book_status not null default 'draft',
  title text,
  cover jsonb not null default '{}'::jsonb,
  pdf_url text,
  page_count int,
  error text,
  built_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index books_family_idx on books(family_id);
create trigger books_updated_at before update on books for each row execute function set_updated_at();

create table extras (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  type text not null,               -- 'tale' | 'video' | 'print_extra' | ...
  status text not null default 'draft',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index extras_family_idx on extras(family_id);
create trigger extras_updated_at before update on extras for each row execute function set_updated_at();

create table demo_orders (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  product text not null,            -- 'digital' | 'print'
  amount_kzt int not null,
  extras jsonb not null default '[]'::jsonb,
  status demo_order_status not null default 'created',
  provider text not null default 'demo',
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index demo_orders_family_idx on demo_orders(family_id);

-- ---------- ИИ: роутер, расход, кэш ----------
create table ai_providers (
  provider text primary key,        -- 'gemini' | 'openai' | 'mock'
  enabled boolean not null default true,
  paid boolean not null default false,
  daily_budget_usd numeric(10, 2),
  monthly_budget_usd numeric(10, 2),
  cooldown_minutes int not null default 10,
  updated_at timestamptz not null default now()
);
create trigger ai_providers_updated_at before update on ai_providers for each row execute function set_updated_at();

create table ai_routes (
  step text primary key,            -- AiStep из lib/ai/types.ts
  -- упорядоченный список: [{"provider":"gemini","model":"...","daily_limit":500,"threshold":0.9}]
  providers jsonb not null,
  pinned_provider text,             -- закреплённый провайдер (админка), иначе null
  timeout_ms int not null default 20000,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
create trigger ai_routes_updated_at before update on ai_routes for each row execute function set_updated_at();

create table ai_usage (
  id bigint generated always as identity primary key,
  step text not null,
  provider text not null,
  model text not null,
  status text not null,             -- 'ok' | 'error' | 'rate_limited' | 'timeout' | 'cache_hit'
  input_tokens int,
  output_tokens int,
  audio_seconds numeric(10, 2),
  images int,
  cost_usd numeric(12, 6) not null default 0,
  latency_ms int,
  error text,
  story_id uuid references stories(id) on delete set null,
  created_at timestamptz not null default now()
);
create index ai_usage_provider_model_time_idx on ai_usage(provider, model, created_at desc);
create index ai_usage_time_idx on ai_usage(created_at desc);

create table ai_cache (
  input_hash text primary key,      -- sha256(step + версия промпта + вход)
  step text not null,
  provider text not null,
  model text not null,
  output jsonb not null,
  created_at timestamptz not null default now()
);

-- ---------- RLS: включён, политик нет ----------
alter table families enable row level security;
alter table kiosk_volunteers enable row level security;
alter table storytellers enable row level security;
alter table sessions enable row level security;
alter table stories enable row level security;
alter table books enable row level security;
alter table extras enable row level security;
alter table demo_orders enable row level security;
alter table ai_providers enable row level security;
alter table ai_routes enable row level security;
alter table ai_usage enable row level security;
alter table ai_cache enable row level security;

-- ---------- Хранилища (приватные; отдаём подписанными ссылками) ----------
insert into storage.buckets (id, name, public)
values
  ('audio', 'audio', false),
  ('photos', 'photos', false),
  ('books', 'books', false),
  ('illustrations', 'illustrations', false)
on conflict (id) do nothing;

-- ---------- Значения по умолчанию для роутера ----------
-- Должны совпадать с lib/ai/config.ts (DEFAULT_PROVIDERS, DEFAULT_ROUTES).
insert into ai_providers (provider, enabled, paid, daily_budget_usd, monthly_budget_usd, cooldown_minutes) values
  ('gemini', true, false, null, null, 10),
  ('openai', true, true, 2.00, 10.00, 10)
on conflict (provider) do nothing;

insert into ai_routes (step, providers, timeout_ms) values
  ('transcribe', '[{"provider":"gemini","model":"gemini-2.5-flash-lite","daily_limit":500,"threshold":0.9},{"provider":"gemini","model":"gemini-2.5-flash","daily_limit":20,"threshold":0.9},{"provider":"openai","model":"gpt-4o-transcribe"}]', 45000),
  ('edit', '[{"provider":"gemini","model":"gemini-2.5-flash-lite","daily_limit":500,"threshold":0.9},{"provider":"gemini","model":"gemini-2.5-flash","daily_limit":20,"threshold":0.9},{"provider":"openai","model":"gpt-5-mini"}]', 30000),
  ('translate', '[{"provider":"gemini","model":"gemini-2.5-flash-lite","daily_limit":500,"threshold":0.9},{"provider":"gemini","model":"gemini-2.5-flash","daily_limit":20,"threshold":0.9},{"provider":"openai","model":"gpt-5-mini"}]', 30000),
  ('completeness', '[{"provider":"gemini","model":"gemini-2.5-flash-lite","daily_limit":500,"threshold":0.9},{"provider":"openai","model":"gpt-5-mini"}]', 12000),
  ('next_question', '[{"provider":"gemini","model":"gemini-2.5-flash-lite","daily_limit":500,"threshold":0.9},{"provider":"openai","model":"gpt-5-mini"}]', 12000),
  ('tale', '[{"provider":"gemini","model":"gemini-2.5-flash-lite","daily_limit":500,"threshold":0.9},{"provider":"gemini","model":"gemini-2.5-flash","daily_limit":20,"threshold":0.9},{"provider":"openai","model":"gpt-5-mini"}]', 40000),
  ('illustrate', '[{"provider":"openai","model":"gpt-image-1"}]', 60000),
  ('persona_reply', '[{"provider":"gemini","model":"gemini-2.5-flash-lite","daily_limit":500,"threshold":0.9},{"provider":"openai","model":"gpt-5-mini"}]', 20000)
on conflict (step) do nothing;
