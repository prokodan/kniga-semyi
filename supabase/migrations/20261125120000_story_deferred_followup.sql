-- #140: ответ, засчитанный до расшифровки (#107), получает проверку полноты после расшифровки.
-- stories.deferred_followup: { status: "pending" | "ask", question_id, text?, checked_at? } или null.
--   pending — интервью засчитало запись без проверки; конвейер проверит полноту, когда будет расшифровка;
--   ask — минимума не хватает: интервью задаст готовое уточнение в конце раздела или в следующей сессии.
-- Только добавляет nullable-колонку; права service_role на stories уже есть. Код терпит отсутствие колонки.
alter table stories add column if not exists deferred_followup jsonb;
