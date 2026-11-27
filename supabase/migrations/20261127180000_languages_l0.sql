-- #230 v2 L0: фундамент языков (дизайн — docs/v2/LANGUAGES.md §1–2). Поведение для семей НЕ меняется:
-- значения по умолчанию = сегодняшний продукт (рассказ ru + корё мар, книга ru,ko, пакеты general + koryo).
-- Только добавляет: новые колонки с умолчаниями, новую таблицу story_texts и зеркало stories → story_texts.

-- 1. Настройки языка (три независимые, LANGUAGES.md §1)
alter table public.families add column if not exists book_langs text[] not null default '{ru,ko}';
alter table public.families add column if not exists culture_packs text[] not null default '{general,koryo}';
alter table public.storytellers add column if not exists spoken_langs text[] not null default '{ru,koryo}';

comment on column public.families.book_langs is
  'Языки книги (#230), первый — основной: {ru,ko} (как сейчас), {ru}, {ru,kk}, {kk,ru}. 1 язык — сплошной текст, 2 — разворот.';
comment on column public.families.culture_packs is
  'Культурные пакеты вопросов (#230): general (всегда) + слои по порядку — koryo, kz, ua… (content/packs, resolveBank).';
comment on column public.storytellers.spoken_langs is
  'Язык рассказа (#230): {ru,koryo} (как сейчас — русский с корё мар), {ru}, {kk}, {ru,kk}.';

-- 2. Тексты главы по языкам. text_ru / title / quote и text_ko / title_ko / quote_ko в stories остаются зеркалом
--    (миграции только добавляют, DECISIONS 27.11). Чтение: строка story_texts есть → она, иначе старые колонки.
create table if not exists public.story_texts (
  story_id uuid not null references public.stories(id) on delete cascade,
  lang text not null check (lang ~ '^[a-z]{2,3}$'),
  title text,
  text text,
  quote text,
  -- ai — собрал конвейер; family — поправила семья; proofread — вычитал носитель (#232)
  origin text not null default 'ai' check (origin in ('ai', 'family', 'proofread')),
  -- ready — как есть в книге; review — ждёт проверки носителем; approved — проверено (#232)
  status text not null default 'ready' check (status in ('ready', 'review', 'approved')),
  updated_at timestamptz not null default now(),
  primary key (story_id, lang)
);
drop trigger if exists story_texts_updated_at on public.story_texts;
create trigger story_texts_updated_at before update on public.story_texts for each row execute function set_updated_at();
alter table public.story_texts enable row level security;
grant all on table public.story_texts to service_role;

-- 3. Зеркало: любая запись текста главы в stories (конвейер, правка семьи, словарь имён, seed-demo, скрипты починки)
--    сразу попадает в story_texts (ru и ko), сброс колонок в null (перезапуск шага) — удаляет строку языка.
--    Так ни один старый путь записи не оставит в story_texts устаревший текст.
--    origin при обновлении не меняется (его уточнят новые пути записи — проверка носителем #232).
create or replace function public.mirror_story_texts() returns trigger
language plpgsql as $$
begin
  -- ru: изменилась любая из колонок → строка = колонки; все три стали null (сброс шага, перевод заново) → строки нет
  if tg_op = 'INSERT'
     or new.text_ru is distinct from old.text_ru or new.title is distinct from old.title or new.quote is distinct from old.quote then
    if new.text_ru is null and new.title is null and new.quote is null then
      delete from public.story_texts where story_id = new.id and lang = 'ru';
    else
      insert into public.story_texts (story_id, lang, title, text, quote)
      values (new.id, 'ru', new.title, new.text_ru, new.quote)
      on conflict (story_id, lang) do update
        set title = excluded.title, text = excluded.text, quote = excluded.quote;
    end if;
  end if;
  if tg_op = 'INSERT'
     or new.text_ko is distinct from old.text_ko or new.title_ko is distinct from old.title_ko or new.quote_ko is distinct from old.quote_ko then
    if new.text_ko is null and new.title_ko is null and new.quote_ko is null then
      delete from public.story_texts where story_id = new.id and lang = 'ko';
    else
      insert into public.story_texts (story_id, lang, title, text, quote)
      values (new.id, 'ko', new.title_ko, new.text_ko, new.quote_ko)
      on conflict (story_id, lang) do update
        set title = excluded.title, text = excluded.text, quote = excluded.quote;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists stories_mirror_texts on public.stories;
create trigger stories_mirror_texts after insert or update of text_ru, title, quote, text_ko, title_ko, quote_ko
  on public.stories for each row execute function public.mirror_story_texts();

-- 4. Уже готовые главы — в story_texts (повторный запуск ничего не дублирует)
insert into public.story_texts (story_id, lang, title, text, quote)
select id, 'ru', title, text_ru, quote from public.stories
where text_ru is not null or title is not null or quote is not null
on conflict (story_id, lang) do nothing;

insert into public.story_texts (story_id, lang, title, text, quote)
select id, 'ko', title_ko, text_ko, quote_ko from public.stories
where text_ko is not null or title_ko is not null or quote_ko is not null
on conflict (story_id, lang) do nothing;
