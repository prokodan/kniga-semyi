# Промпты

Один файл = один шаг роутера (`lib/ai/types.ts → AI_STEPS`). Вход приходит JSON-ом в сообщении пользователя, ответ — **только JSON** по схеме внизу файла (её проверяет `outputSchemas`).

- Правит Влад (V1) без агента. Схему ответа не менять без PR в `lib/ai/types.ts` (Z6).
- Правка промпта меняет его версию → кэш ИИ для шага сбрасывается сам.
- Проверка качества: `eval/` (I11), прогон персонажей (I15).

**Перевод — по файлу на язык книги (#230):** `translate.<язык>.md` — `translate.ko.md` (ru → ko, бывший `translate.md`),
`translate.kk.md` (ru → kk) и `translate.ru.md` (kk → ru) — #231, флаг `lang_kk`. Какой взять — по `to` во входе
(`lib/ai/prompts.ts → promptVariant`). kk / ru отвечают ключами `text / title / quote`. Глоссарий kk — `content/packs/kz/glossary.ts`
(тест сверяет, что все его слова есть в `translate.kk.md`): правите слово — правьте оба файла.

**#105 п. 1 (флаг `lang_kk`):** `completeness.next.md` = `completeness.md` + выбор следующего вопроса (`next_question.md`)
одним вызовом. Правите правило полноты или выбора вопроса — правьте и его.
