-- Пункт 1 финальных исправлений: застрявшие главы.
-- kick_attempts — сколько раз workflow kick-stuck перезапускал историю (после 3 → failed с причиной);
-- step_started_at — «аренда» шага: пока шаг идёт (< 65 с), второй вызов /process его не дублирует.
-- Новых таблиц нет — grant'ы service_role не нужны.
alter table stories add column if not exists kick_attempts int not null default 0;
alter table stories add column if not exists step_started_at timestamptz;
