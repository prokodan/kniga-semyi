# Статус

Обновляет агент в том же PR, что и работу: только строку своей зоны и, если нужно, «Блокеры».
Задачи — GitHub Issues; здесь — короткое «где мы сейчас».

**Сегодня:** вс 22.11 · **Фриз фич:** ср 25.11 14:00 · **Полуфинал:** пт 27.11

| Зона | Состояние | Последнее | Дальше |
| --- | --- | --- | --- |
| Z6 Платформа | 🟢 каркас W0 | Next.js, миграции, роутер ИИ (mock/gemini/openai), CI/migrate/smoke/notify, шаблоны | Ручная настройка Vercel + Secrets, первый `migrate` |
| Z2 ИИ-конвейер | 🟡 I10 в PR | I10 интервью-агент: `lib/interview` + `/api/sessions` (старт, ответ, пропуск/позже), 7 профилей в mock; банк из `content/questions` подменяется V0 без правки кода | I2 конвейер, I15 симулятор (может звать `createInterview` напрямую) |
| Z1 Запись и интервью | ⚪ не начато | Банк-заглушка: 8 вопросов | I1 старт семьи + запись; V0 банк вопросов |
| Z3 Глава, книга, QR | ⚪ не начато | — | I3 глава, I5 книга PDF |
| Z4 Демо-оплата и допы | ⚪ не начато | Порт оплаты demo | I7 |
| Z5 АКНЦ | ⚪ не начато | — | I4 киоск, I9 кабинет |

## Блокеры
- Цены для демо-оплаты из фин. модели (`lib/payments/index.ts`, сейчас 0 ₸) — нужны к I7.
- Сверить актуальные имена моделей и бесплатные квоты Gemini в AI Studio перед I2.

## Ручные шаги после W0 (Данил)
- [ ] Vercel: импорт репозитория, Environment Variables из `.env.example` (Production + Preview)
- [ ] GitHub Secrets: `SUPABASE_DB_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PROD_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- [ ] Actions → migrate → Run workflow; в Supabase появились 12 таблиц и 4 хранилища
- [ ] Actions → smoke → Run workflow → зелёный; `/api/health` → `"status":"ok","db":"ok"`
- [ ] Защита main: обязательная проверка `ci`
