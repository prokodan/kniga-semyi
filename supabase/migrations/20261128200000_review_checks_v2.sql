-- #353 (v2 Q2, docs/v2/QUALITY_LOOP.md §2, §4): /review 2.0 — режимы «текст» и «слова», критерии с якорями,
-- язык интерфейса проверяющего, отметка «готово». Миграция только добавляет: у старых ссылок (#232) новые поля
-- пустые (kind = null) — страница /review показывает их как раньше.

-- kind: null — старая ссылка #232 (mode texts | questions); text — целые тексты; terms — только фокус-слова
alter table public.review_links add column if not exists kind text;
alter table public.review_links drop constraint if exists review_links_kind_check;
alter table public.review_links add constraint review_links_kind_check check (kind is null or kind in ('text', 'terms'));
-- критерии, которые видит проверяющий: ["meaning","natural","respect","names","grammar"] (null — старые 5 осей)
alter table public.review_links add column if not exists criteria jsonb;
-- язык интерфейса проверяющего: ko | kk | ru (подписи всегда ещё и по-русски); null — язык перевода пары
alter table public.review_links add column if not exists ui_lang text;
alter table public.review_links drop constraint if exists review_links_ui_lang_check;
alter table public.review_links add constraint review_links_ui_lang_check check (ui_lang is null or ui_lang in ('ru', 'ko', 'kk'));
-- проверяющий нажал «Готово» на итоговом экране
alter table public.review_links add column if not exists completed_at timestamptz;

-- фокус-слова перевода для режима «слова»: [{"term":"할머니","hint":"бабушка"}, …] (3–8)
alter table public.review_items add column if not exists focus_terms jsonb;
-- откуда материал: quality_items.id (банк Q1, #352). Пока Q1 не в main — null (материал из наборов eval / демо).
alter table public.review_items add column if not exists item_ref uuid;

-- оценка фокус-слов (строка paragraph = -1): {"0":{"ok":true},"1":{"ok":false,"fix":"오빠"}} — ключ = номер слова
alter table public.review_feedback add column if not exists terms jsonb not null default '{}'::jsonb;

-- Ссылка item_ref → quality_items — когда таблица банка уже есть (порядок миграций Q1 / Q2 может быть любым;
-- иначе внешний ключ добавит отдельная миграция после слияния Q1, см. заметки PR #353).
do $$
begin
  if to_regclass('public.quality_items') is not null
     and not exists (select 1 from pg_constraint where conname = 'review_items_item_ref_fkey') then
    alter table public.review_items
      add constraint review_items_item_ref_fkey foreign key (item_ref) references public.quality_items(id) on delete set null;
  end if;
end $$;

create index if not exists review_items_item_ref_idx on public.review_items (item_ref) where item_ref is not null;
