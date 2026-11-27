-- #232 (v2 R, docs/v2/LANGUAGES.md §3): ссылки для носителей языка /review/<токен>.
-- Только вымышленные тексты (главы eval-персонажей и демо, вопросы банка) — главы живых семей сюда не попадают:
-- review_items заполняет только /admin/reviews из наборов в коде (app/admin/reviews/_lib/sets.ts), не из stories.
-- Миграция только добавляет. Токен ссылки хранится хэшем (sha256), сам токен показываем один раз при создании.

create table if not exists public.review_links (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  -- языковая пара «откуда-куда»: ru-ko, ru-kk (kk-ru — после L1)
  pair text not null check (pair ~ '^[a-z]{2}-[a-z]{2}$'),
  mode text not null default 'texts' check (mode in ('texts', 'questions')),
  -- только инициалы проверяющего («А. К.»), без полного имени
  reviewer_label text not null check (char_length(reviewer_label) between 1 and 16),
  -- набор текстов: demo | bank | eval:<имя> (см. sets.ts)
  items_set text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.review_links enable row level security;
grant all on table public.review_links to service_role;

create table if not exists public.review_items (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.review_links(id) on delete cascade,
  position int not null default 0,
  kind text not null check (kind in ('chapter', 'question')),
  source_lang text not null check (source_lang ~ '^[a-z]{2}$'),
  target_lang text not null check (target_lang ~ '^[a-z]{2}$'),
  title text,
  source_text text not null,
  model_text text not null,
  -- версия промпта / коммит, которым получен model_text («demo #122», sha промпта прогона eval)
  prompt_version text,
  -- вымышленный персонаж (eval) или демо: kim, demo:kim, bank:general — никогда не семья
  persona text not null,
  created_at timestamptz not null default now()
);
create index if not exists review_items_link_idx on public.review_items (link_id, position);
alter table public.review_items enable row level security;
grant all on table public.review_items to service_role;

create table if not exists public.review_feedback (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.review_items(id) on delete cascade,
  -- номер абзаца (0…); -1 — отзыв на весь текст (оценки, комментарий, «пропустить»)
  paragraph int not null default -1,
  edited_text text,
  -- {meaning, grammar, natural, respect, names}: 1–5, пустая ось — не оценено
  ratings jsonb not null default '{}'::jsonb,
  comment text,
  skipped boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, paragraph)
);
drop trigger if exists review_feedback_updated_at on public.review_feedback;
create trigger review_feedback_updated_at before update on public.review_feedback for each row execute function set_updated_at();
alter table public.review_feedback enable row level security;
grant all on table public.review_feedback to service_role;
