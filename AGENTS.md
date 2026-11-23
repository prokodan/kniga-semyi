# AGENTS.md — правила для всех агентов

«Книга семьи»: семья записывает голос старшего → ИИ делает главу RU | KR → книга в PDF.
MLP к полуфиналу Startup-Nunchi **27.11.2026**. Фичи замораживаются **в среду 25.11 в 14:00**.
Подробности — в `docs/` (читай по ссылке, когда нужно, а не целиком).

## С чего начать любую задачу
1. Прочитай этот файл, свою issue и `docs/STATUS.md`. Больше ничего заранее не читай.
2. Работай только с файлами из раздела «Файлы» issue. Не сканируй репозиторий.
3. Ветка `zN/кратко-о-задаче` (N — номер зоны), например `z2/router-pipeline`.
4. Перед PR: `npm run check` (типы, линтер, тесты, миграции в PGlite).
5. PR по шаблону: что сделано, как проверить, что осталось. `Closes #N`.
6. В том же PR обнови строку своей зоны в `docs/STATUS.md`.

## Зоны и владельцы
| Зона | Папки | Кто |
| --- | --- | --- |
| Z1 Запись и интервью | `app/(family)/record`, `components/recorder`, `content/questions` | Codex / Влад |
| Z2 ИИ-конвейер | `lib/ai` (кроме `index.ts`, `types.ts`), `lib/pipeline`, `prompts/`, `eval/`, `fixtures/` | Claude / Данил; промпты и оценка — Влад |
| Z3 Глава, книга, QR | `app/(family)/chapter`, `app/book`, `app/listen`, `lib/book` | Claude / Данил |
| Z4 Демо-оплата и допы | `app/(family)/checkout`, `app/(family)/extras` | Codex / Влад |
| Z5 АКНЦ | `app/kiosk`, `app/center` | Codex / Влад |
| Z6 Платформа | `lib/types`, `lib/db`, `lib/env.ts`, `lib/payments`, `supabase/`, `.github/`, `app/globals.css`, `app/api/health` | Claude / Данил |

**Общие файлы меняет только Z6:** `lib/types/*`, `lib/ai/index.ts`, `lib/ai/types.ts`, `supabase/migrations/*`,
`app/globals.css` (дизайн-токены), `.github/*`, `package.json` (зависимости). Нужна правка контракта —
опиши её в PR и отметь Данила, не меняй сам.

## Карта папок
```
app/                 маршруты Next.js (App Router); app/api/* — серверные ручки
  api/health         проверка живости (smoke)
components/          общие UI-компоненты (ui/ — базовые, остальное по зонам)
content/questions    банк вопросов и блоки карты жизни
lib/types            контракты домена (= схема базы)
lib/db               серверный клиент Supabase (service-ключ), бакеты
lib/ai               роутер ИИ: ai.run(step, input); провайдеры mock | gemini | openai
lib/payments         порт оплаты, в MLP только demo
prompts/<step>.md    промпты шагов ИИ (правит Влад)
fixtures/ai          готовые ответы заглушки ИИ
eval/                персонажи, профили поведения, отчёты качества
supabase/migrations  SQL-миграции (только добавляют)
docs/                PRODUCT, ARCHITECTURE, DECISIONS, STATUS
scripts/             служебные скрипты
```

## Жёсткие правила
- **ИИ только через роутер:** `import { ai } from "@/lib/ai"` → `ai.run("edit", input)`. Никаких прямых
  вызовов SDK моделей. Новый шаг = PR Z6 в `lib/ai/types.ts` + промпт + маршрут в миграции.
- **По умолчанию `AI_MODE=mock`.** Всё должно работать и тестироваться без ключей. Не трать API в тестах.
- **База только с сервера.** Браузер не ходит в Supabase. Server actions / `app/api/*` + `getDb()` из `lib/db`.
  `lib/db` и `lib/ai` импортируют `server-only` — не тащи их в клиентские компоненты.
- **Семья входит по ссылке с токеном** (`families.access_token`), без регистрации. Не добавляй авторизацию.
- **Миграции только добавляют.** Новый файл `supabase/migrations/<YYYYMMDDHHMMSS>_<что>.sql`. Старые не
  редактировать. Таблицы руками не создавать — их применит workflow `migrate` после слияния.
- **Каждая новая таблица в миграции — сразу grant для `service_role`** в том же файле:
  `grant all on table <имя> to service_role;` (для `identity`/`serial` — и на её sequence).
  Без этого сервер ловит `permission denied`, а `/api/health` отдаёт `db: "error"`. `npm run db:check`
  падает, если у `service_role` нет прав на какую-либо таблицу `public`.
- **Секреты** только в Vercel Env и GitHub Secrets. Не коммить `.env*`, не печатай ключи в логи и PR.
- **Голосовое согласие** обязательно до первой записи рассказчика. Архив АКНЦ — только с `archive_consent`.
- **Стили** — классы Tailwind из токенов `app/globals.css` (`bg-paper`, `text-ink`, `bg-seal`, `text-elder`…).
  Новых цветов в компонентах не вводить. Кнопки ≥ 48 px. Мобильный в первую очередь (iPhone Safari).
- **Тексты интерфейса** — на русском, тёплым языком, на «вы». Корейский — где это видно комиссии.
- Не добавляй зависимости без нужды; если нужно — объясни в PR.
- Не трогай `main` напрямую — только через PR. Агент сам сливает свой PR (squash), когда зелёные `ci` **и** `e2e`
  (для `prompts/` — ещё комментарий `eval` без 🔴 по фактам). При красной проверке не сливать никогда.
- **Всё важное — в репозиторий, не только в чат:** раздел PR «📝 Заметки для команды» (решения, что не сделано,
  что проверить руками, риски); каждое «осталось / потом / руками» — сразу отдельная issue. Подробно — `docs/HANDOFF.md` §3.

## Команды
```
npm run dev          # локально, http://localhost:3000 (без ключей — mock)
npm run check        # typecheck + lint + test + db:check — обязательно перед PR
npm run build        # сборка как на Vercel
npm run db:check     # прогнать миграции в PGlite
```

## Конвейер истории
`uploaded → transcribing → editing → translating → ready` (или `failed` + `stories.error`).
Шаг = отдельная функция, перезапускаемая. Результат каждого шага сохраняется в `stories`; ответы моделей
кэшируются по хэшу входа (`ai_cache`), повтор не стоит денег. `AiUnavailableError` → очередь / режим сцены.

## Если что-то неясно
Не угадывай контракт. Остановись и напиши вопрос в issue или в описании PR. Решения фиксируются в
`docs/DECISIONS.md`.
