-- #352 (v2 Q1, docs/v2/QUALITY_LOOP.md §2): банк проверок контура качества — личности и тексты с нюансами,
-- прогоны боевым конвейером на staging и то, что увидит проверяющий. Только вымышленные данные: строки пишут
-- сид банка (eval/quality, eval/personas), «+ Личность / + Текст» и «Сгенерировать N» в /admin/quality и джоб
-- quality-run — никогда не главы семей. Миграция только добавляет.

-- Личности: pair — «откуда-куда» (ru-ko, ru-kk; kk-ru — рассказ по-казахски), pack — культурный пакет (koryo, kz, general).
-- bio — биография для persona_reply (у seed из eval/personas — markdown персонажа без «Ключевых фактов»).
create table if not exists public.quality_personas (
  id uuid primary key default gen_random_uuid(),
  pair text not null check (pair ~ '^[a-z]{2}-[a-z]{2}$'),
  pack text not null default 'general',
  name text not null check (char_length(name) between 1 and 120),
  bio text not null,
  speech_style text not null default '',
  tags text[] not null default '{}',
  -- new — ещё не прогоняли; active — в прогонах; archived — в архиве (quality-run не берёт)
  status text not null default 'new' check (status in ('new', 'active', 'archived')),
  source text not null default 'manual' check (source in ('seed', 'generated', 'manual')),
  -- ключ сида (eval-персонаж kim, seed:ru-kk:aigul) — повторный сид не дублирует и не трогает статус
  seed_key text unique,
  created_at timestamptz not null default now()
);
create index if not exists quality_personas_pair_idx on public.quality_personas (pair, status);
alter table public.quality_personas enable row level security;
grant all on table public.quality_personas to service_role;

-- Тексты с нюансами (100–250 слов на языке оригинала пары), размечены тегами нюансов (lib/quality/types.ts).
-- focus_terms — слова оригинала, на которые смотреть проверяющему (родство, обращения, реалии) — для режима «слова» (Q2).
create table if not exists public.quality_texts (
  id uuid primary key default gen_random_uuid(),
  pair text not null check (pair ~ '^[a-z]{2}-[a-z]{2}$'),
  persona_id uuid references public.quality_personas(id) on delete set null,
  event text not null default '',
  text_src text not null check (char_length(text_src) between 20 and 4000),
  nuance_tags text[] not null default '{}',
  focus_terms jsonb not null default '[]'::jsonb,
  status text not null default 'new' check (status in ('new', 'active', 'archived')),
  source text not null default 'manual' check (source in ('seed', 'generated', 'manual')),
  seed_key text unique,
  created_at timestamptz not null default now()
);
create index if not exists quality_texts_pair_idx on public.quality_texts (pair, status);
create index if not exists quality_texts_persona_idx on public.quality_texts (persona_id);
alter table public.quality_texts enable row level security;
grant all on table public.quality_texts to service_role;

-- Прогон одной личности или одного текста боевым конвейером. prompt_versions — хэши файлов prompts/* (sha256, 12
-- символов), models — маршруты ai_routes шагов прогона и модели, которые ответили. env — staging (prod не пишет).
create table if not exists public.quality_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('persona', 'text')),
  ref_id uuid not null,
  pair text not null check (pair ~ '^[a-z]{2}-[a-z]{2}$'),
  commit_sha text,
  prompt_versions jsonb not null default '{}'::jsonb,
  models jsonb not null default '{}'::jsonb,
  env text not null default 'staging',
  -- ok — всё переведено; partial — часть глав не собралась; budget — упёрлись в лимит $; error — ИИ недоступен
  status text not null default 'ok' check (status in ('ok', 'partial', 'budget', 'error')),
  calls int not null default 0,
  cost_usd numeric(10, 4) not null default 0,
  error text,
  -- запуск джоба (GitHub run id) — прогоны одного нажатия «Прогнать»
  batch text,
  created_at timestamptz not null default now()
);
create index if not exists quality_runs_ref_idx on public.quality_runs (ref_id, created_at desc);
create index if not exists quality_runs_created_idx on public.quality_runs (created_at desc);
alter table public.quality_runs enable row level security;
grant all on table public.quality_runs to service_role;

-- То, что увидит проверяющий: оригинал → результат шага (перевод главы / текста).
create table if not exists public.quality_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.quality_runs(id) on delete cascade,
  position int not null default 0,
  title text,
  src_text text not null,
  out_text text not null,
  lang_from text not null check (lang_from ~ '^[a-z]{2}$'),
  lang_to text not null check (lang_to ~ '^[a-z]{2}$'),
  step text not null default 'translate',
  focus_terms jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists quality_items_run_idx on public.quality_items (run_id, position);
alter table public.quality_items enable row level security;
grant all on table public.quality_items to service_role;

-- Шаг ИИ quality_generate (lib/ai/types.ts): самая сильная модель OpenAI по ключу — gpt-5.5, если ключ её не видит
-- (404) — gpt-5.4, затем gpt-5.4-mini. Должно совпадать с DEFAULT_ROUTES в lib/ai/config.ts.
insert into ai_routes (step, providers, timeout_ms) values
  ('quality_generate', '[{"provider":"openai","model":"gpt-5.5"},{"provider":"openai","model":"gpt-5.4"},{"provider":"openai","model":"gpt-5.4-mini"}]', 50000)
on conflict (step) do nothing;
