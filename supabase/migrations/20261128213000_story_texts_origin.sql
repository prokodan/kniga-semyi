-- #246: story_texts.origin — чья это правка. Зеркало stories_mirror_texts (20261127180000) писало новую строку с
-- origin = 'ai' и при обновлении origin не меняло, поэтому глава, поправленная семьёй в черновике, оставалась «ai»
-- (отметку #149 ставил отдельный запрос после перевода — до 60 с позже и мог не дойти).
--
-- Теперь путь записи говорит, кто пишет, заголовком запроса PostgREST `x-text-origin` (family | proofread | ai):
-- зеркало берёт его из request.headers в той же транзакции и пишет origin вместе с текстом — атомарно.
-- Заголовка нет (конвейер, словарь имён, seed-demo, скрипты) — всё как раньше: новая строка 'ai', у старой origin
-- не меняется. Пересборка с edit (text_ru → null) по-прежнему удаляет строку ru — отметка снимается сама.
-- Только добавляет: новая версия функции, триггер прежний (create or replace).
create or replace function public.story_text_origin() returns text
language plpgsql stable as $$
declare
  h text := nullif(current_setting('request.headers', true), '');
  v text;
begin
  if h is null then return null; end if;
  begin
    v := lower(h::json ->> 'x-text-origin');
  exception when others then
    return null; -- не JSON — как без заголовка
  end;
  if v in ('ai', 'family', 'proofread') then return v; end if;
  return null;
end;
$$;

create or replace function public.mirror_story_texts() returns trigger
language plpgsql as $$
declare
  o text := public.story_text_origin();
begin
  if tg_op = 'INSERT'
     or new.text_ru is distinct from old.text_ru or new.title is distinct from old.title or new.quote is distinct from old.quote then
    if new.text_ru is null and new.title is null and new.quote is null then
      delete from public.story_texts where story_id = new.id and lang = 'ru';
    else
      insert into public.story_texts (story_id, lang, title, text, quote, origin)
      values (new.id, 'ru', new.title, new.text_ru, new.quote, coalesce(o, 'ai'))
      on conflict (story_id, lang) do update
        set title = excluded.title, text = excluded.text, quote = excluded.quote,
            origin = coalesce(o, public.story_texts.origin);
    end if;
  end if;
  if tg_op = 'INSERT'
     or new.text_ko is distinct from old.text_ko or new.title_ko is distinct from old.title_ko or new.quote_ko is distinct from old.quote_ko then
    if new.text_ko is null and new.title_ko is null and new.quote_ko is null then
      delete from public.story_texts where story_id = new.id and lang = 'ko';
    else
      insert into public.story_texts (story_id, lang, title, text, quote, origin)
      values (new.id, 'ko', new.title_ko, new.text_ko, new.quote_ko, coalesce(o, 'ai'))
      on conflict (story_id, lang) do update
        set title = excluded.title, text = excluded.text, quote = excluded.quote,
            origin = coalesce(o, public.story_texts.origin);
    end if;
  end if;
  return new;
end;
$$;
