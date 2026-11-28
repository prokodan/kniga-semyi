-- #320: «Есть новое дополнение — пересобрать?». Ответ на уточнение дописан в stories.followups, а глава уже
-- собрана (#149: старая / поправленная семьёй главу сами не пересобираем) — дополнения в тексте нет.
-- Ставит интервью (lib/interview/engine.ts), снимается само, когда глава пересобирается с шага edit
-- (конвейер обнуляет text_ru → триггер ниже). Только добавляет: новая колонка и новый триггер.
alter table public.stories add column if not exists addition_pending boolean not null default false;

create or replace function public.stories_clear_addition_pending() returns trigger
language plpgsql
as $$
begin
  -- пересборка с edit: text_ru был → стал null; новый текст соберётся уже с дополнением
  if old.text_ru is not null and new.text_ru is null then
    new.addition_pending := false;
  end if;
  return new;
end;
$$;

drop trigger if exists stories_clear_addition_pending on public.stories;
create trigger stories_clear_addition_pending before update of text_ru
  on public.stories for each row execute function public.stories_clear_addition_pending();
