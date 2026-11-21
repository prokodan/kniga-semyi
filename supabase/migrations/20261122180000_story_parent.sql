-- I2: голосовой ответ на уточнение интервью-агента — отдельная запись в stories со ссылкой на основную.
-- Конвейер только расшифровывает такую запись (transcript уходит в followups основной), главой она не становится.
-- Новых таблиц нет — grant'ы service_role не нужны (колонка наследует права таблицы).
alter table stories add column if not exists parent_story_id uuid references stories(id) on delete cascade;
create index if not exists stories_parent_idx on stories(parent_story_id) where parent_story_id is not null;
