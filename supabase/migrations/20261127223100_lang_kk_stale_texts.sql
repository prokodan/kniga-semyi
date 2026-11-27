-- #231 v2 L1 (флаг lang_kk): переводы главы без колонок в stories (kk) живут только в story_texts.
-- Русский текст главы изменился (пересборка, правка семьи, словарь имён, скрипты починки) — перевод ИИ на такие языки
-- устарел: удаляем его строку, конвейер переведёт заново (план перевода — lib/pipeline/langs.ts).
-- ru / ko не трогаем — их ведёт зеркало stories_mirror_texts (20261127180000). Правки людей (origin family /
-- proofread, #232) не удаляем. Только добавляет: новая функция и триггер; для семей без kk ничего не меняется.

create or replace function public.drop_stale_translations() returns trigger
language plpgsql as $$
begin
  if new.text_ru is distinct from old.text_ru then
    delete from public.story_texts
    where story_id = new.id and lang not in ('ru', 'ko') and origin = 'ai';
  end if;
  return new;
end;
$$;

drop trigger if exists stories_stale_translations on public.stories;
create trigger stories_stale_translations after update of text_ru
  on public.stories for each row execute function public.drop_stale_translations();
