-- #102 / #104: словарь сущностей семьи — люди, места и особые слова (корё мар) из всех глав книги.
-- Контракт — issue #104. Автозаполнение при сборке каждой главы — #102 (source='auto');
-- страница /f/<token>/names и правка — #104 (source='family', автоматика такие записи не перезаписывает).
create table if not exists family_entities (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  kind text not null check (kind in ('person', 'place', 'word')),
  name_ru text not null,
  name_ko text,
  -- кем ИИ его понял: «сосед, друг детства», «посёлок, где родился рассказчик»
  description text,
  -- в каких главах встречается
  story_ids uuid[] not null default '{}',
  source text not null default 'auto' check (source in ('auto', 'family')),
  updated_at timestamptz not null default now()
);
create unique index if not exists family_entities_family_name_uq on family_entities (family_id, lower(name_ru));
create trigger family_entities_updated_at before update on family_entities for each row execute function set_updated_at();

grant all on table family_entities to service_role;
