-- #204: расход ИИ по семье. Шаги без истории (сказка `tale`, картинки `illustrate`) пишутся в ai_usage без story_id,
-- поэтому в расход семьи (/admin/families, себестоимость книги в /admin/ai — #105 п. 6) не попадали.
-- ai_usage.family_id — семья вызова; пишет роутер, где семья известна (RunOptions.familyId). Только добавляем:
-- nullable, старые строки — null (их семья находится через story_id → stories.family_id), прод без колонки пишет как раньше.
-- Строки, которые превью шлёт в прод (env = 'staging'), family_id не несут — таких семей в проде нет.
-- Новых таблиц нет — grant'ы service_role не нужны.

alter table public.ai_usage add column if not exists family_id uuid references public.families(id) on delete set null;

create index if not exists ai_usage_family_idx on public.ai_usage(family_id, created_at desc) where family_id is not null;
