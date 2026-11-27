-- #235 v2 T: древо семьи (флаг family_tree; дизайн — PR #254 и docs/v2/LANGUAGES.md §4).
-- Только добавляет. Поколение не храним — считаем по рёбрам от того, чью книгу смотрят.

-- 1. Рёбра древа между людьми словаря семьи (family_entities kind=person).
--    parent: from = родитель → to = ребёнок; spouse / sibling — без направления (храним одно ребро на пару).
--    source: auto — собрала автоматика из словаря и facts глав; family — поправила семья (автоматика не трогает).
create table if not exists public.family_relations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  from_entity_id uuid not null references public.family_entities(id) on delete cascade,
  to_entity_id uuid not null references public.family_entities(id) on delete cascade,
  kind text not null check (kind in ('parent', 'spouse', 'sibling')),
  source text not null default 'auto' check (source in ('auto', 'family')),
  created_at timestamptz not null default now(),
  check (from_entity_id <> to_entity_id)
);
create unique index if not exists family_relations_uq on public.family_relations (family_id, from_entity_id, to_entity_id, kind);
create index if not exists family_relations_family_idx on public.family_relations (family_id);

grant all on table public.family_relations to service_role;

-- 2. Рассказчик — человек древа.
alter table public.storytellers add column if not exists entity_id uuid references public.family_entities(id) on delete set null;

-- 3. Для древа у людей словаря: годы, он / она (подписи «мама / папа»), «это один человек» на древе
--    (запись остаётся в словаре — подсказки расшифровке не теряются; на древе её рёбра и главы у главной).
alter table public.family_entities add column if not exists birth_year int;
alter table public.family_entities add column if not exists death_year int;
alter table public.family_entities add column if not exists gender text check (gender in ('f', 'm'));
alter table public.family_entities add column if not exists same_as uuid references public.family_entities(id) on delete set null;

comment on table public.family_relations is
  'Древо семьи (#235): рёбра parent (from — родитель) / spouse / sibling между family_entities. auto — автоматика, family — правка семьи.';
comment on column public.storytellers.entity_id is 'Человек древа (family_entities), который этот рассказчик (#235).';
comment on column public.family_entities.same_as is 'Древо (#235): «это один человек» — на древе запись показывается как same_as.';
