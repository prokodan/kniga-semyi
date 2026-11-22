# Архитектура

## Стек
- **Next.js 16** (App Router, TypeScript strict, Tailwind 4) на **Vercel**, регион `fra1` (`vercel.json`).
- **Supabase** (Postgres + Storage), регион Frankfurt. Доступ только с сервера по service-ключу.
- **GitHub Actions:** `ci` (каждый PR), `migrate` (слияние в main), `smoke` (ежедневно), `notify` (Telegram).
- **ИИ:** роутер `lib/ai` → провайдеры `mock | gemini | openai`.

## Поток данных
```
Телефон / планшет ──► app/(family)/*, app/kiosk/*  (React, без доступа к базе)
        │  server actions / app/api/*
        ▼
   lib/db (service key) ──► Supabase Postgres + Storage (audio, photos, books, illustrations)
        │
   lib/pipeline (I2) ──► ai.run(step) ──► роутер ──► Gemini (free) → Gemini Flash → OpenAI (paid)
                                            │            ▲ кэш ai_cache, учёт ai_usage
                                            └─ AiUnavailableError → очередь / режим сцены
```
Аудио грузится из браузера напрямую в Storage по подписанной ссылке (обход лимита тела функции Vercel).

## Таблицы
| Таблица | Назначение |
| --- | --- |
| `families` | Книга семьи. `access_token` — вход по ссылке, `archive_consent`, `is_demo` |
| `storytellers` | Рассказчик: имя, годы, фото, `consent_audio_url` + `consent_at` |
| `sessions` | Сеанс интервью (семья или киоск), `state` интервью-агента |
| `stories` | История: аудио → `transcript` → `text_ru`/`text_ko`, `title`, `quote`, `facts`, `followups`, `status` |
| `books` | Сборка книги: `status`, `pdf_url` |
| `extras` | Допы (сказка и др.), данные в `data` |
| `demo_orders` | Демо-заказы (`paid_demo`) |
| `kiosk_volunteers` | Волонтёры АКНЦ |
| `ai_routes` | Шаг → упорядоченные провайдеры, пороги, закрепление, таймаут |
| `ai_providers` | Провайдер: вкл/выкл, платный, бюджет дня и месяца, остывание |
| `ai_usage` | Каждый вызов: шаг, провайдер, модель, токены / секунды / картинки, стоимость, статус |
| `ai_cache` | Ответы моделей по `sha256(шаг + версия промпта + вход)` |

Хранилища: `audio`, `photos`, `books`, `illustrations` — приватные, отдаём подписанными ссылками.
RLS включён на всех таблицах без политик: anon-ключ ничего не видит.

## Роутер ИИ
`ai.run(step, input)` (`lib/ai/router.ts`):
1. Валидирует вход (`inputSchemas`), загружает `prompts/<step>.md`.
2. `AI_MODE=mock` → заглушка (`fixtures/ai`), без кэша. Иначе — кэш по хэшу.
3. Маршрут шага из `ai_routes` (или `DEFAULT_ROUTES`). `AI_MODE=gemini|openai` оставляет одного провайдера,
   `pinned_provider` — закреплённого из админки.
4. По порядку пропускает кандидата, если: нет ключа / не умеет шаг / выключен; остывает (429 или таймаут за
   последние `cooldown_minutes`); квота суток ≥ `daily_limit × threshold` (сутки Gemini — по Тихоокеанскому
   времени); платный и исчерпан бюджет дня или месяца.
5. Вызов с таймаутом. Ответ проверяется `outputSchemas`. 429/таймаут/ошибка/неверный JSON → запись в
   `ai_usage` → следующий кандидат.
6. Все отпали → `AiUnavailableError` (история в очередь, «глава будет готова через N минут» или режим сцены).

| Шаг | Порядок по умолчанию | Заглушка |
| --- | --- | --- |
| `transcribe` | Flash-Lite → Flash → gpt-4o-transcribe | `fixtures/ai/transcribe.json` |
| `edit` (текст, заголовок, цитата, факты) | Flash-Lite → Flash → gpt-5-mini | `edit.json` |
| `translate` | Flash-Lite → Flash → gpt-5-mini | `translate.json` |
| `completeness` (интервью-агент) | Flash-Lite → gpt-5-mini | эвристика по длине ответа |
| `next_question` | Flash-Lite → gpt-5-mini | первый непокрытый блок |
| `tale` | Flash-Lite → Flash → gpt-5-mini | `tale.json` |
| `illustrate` | gpt-image-2 → gpt-image-1.5 | SVG-плейсхолдер |
| `persona_reply` (симулятор) | Flash-Lite → gpt-5-mini | строка из биографии персонажа |

Модели и лимиты — данные, а не код: меняются в `ai_routes` / админке `/admin/ai` (I14).

## Конвейер истории (I2)
`uploaded → transcribing → editing → translating → ready | failed`. Каждый шаг — функция
`(storyId) => Promise<void>` в `lib/pipeline`, сохраняет результат в `stories` и двигает статус. Перезапуск
шага не повторяет уже сохранённые. Запуск — по API после загрузки аудио; шаги отдельными вызовами (лимит
функций Vercel 60 с).

## Интервью-агент (I10)
Для каждого вопроса банка задан `minimum`. После ответа → `ai.run("completeness")` → до 3 уточнений про
конкретный пробел, «пропустить / вернуться позже», `offTopicBlock` засчитывает ответ в нужный блок. Минимум
собран → `ai.run("next_question")`. Состояние — `sessions.state`. Один механизм для семьи и киоска.

## Оплата
`lib/payments`: интерфейс `PaymentPort`, в MLP только `createDemoPayments` (`paid_demo`). Цены — один
источник `PRICES_KZT` / `EXTRAS_KZT` (заполнить из фин. модели в I7).

## Режим сцены (I12)
`npm run seed:demo` пересоздаёт демо-семью; при `STAGE_MODE` и ответе ИИ дольше 20 с показываем заранее
сгенерированный результат для этой истории.
