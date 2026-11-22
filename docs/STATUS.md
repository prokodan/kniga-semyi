# Статус

Обновляет агент в том же PR, что и работу: только строку своей зоны и, если нужно, «Блокеры».
Задачи — GitHub Issues; здесь — короткое «где мы сейчас».

**Сегодня:** вс 22.11 · **Фриз фич:** ср 25.11 14:00 · **Полуфинал:** пт 27.11

| Зона | Состояние | Последнее | Дальше |
| --- | --- | --- | --- |
| Z6 Платформа | 🟢 каркас W0 + хотфикс + I14 | I14 админка `/admin/ai` (ADMIN_PIN): расход $ день/месяц и прогноз, квоты моделей из `ai_routes` (Gemini — по Тихоокеанскому), доля кэша, остывание, 20 ошибок; вкл/выкл провайдера, закрепление, порядок, квота/порог, бюджеты — без деплоя; JSON `/api/admin/ai/summary` | `migrate` → `smoke` зелёный; I3 |
| Z2 ИИ-конвейер | 🟢 I2 + I15 готово | I15 симулятор `npm run sim -- --persona kim [--behavior <профиль>\|all] [--questions N] [--max-calls N]`: персонаж (`persona_reply`) ↔ интервью-агент I10 (`createInterview`) → главы `edit`+`translate` → отчёт `eval/reports/` (уточнения по вопросам, факты найдены/искажены/потеряны, в разговоре и в главах); в реальном режиме ≤ 60 запросов к ИИ на прогон | I1 подключается к `/process`; замер 5-мин истории на Gemini; прогон kim/pak/tsoi на Gemini → I11; `--pdf` после I5 |
| Z1 Запись и интервью | 🟢 I1 готово | I1: `/start` → `/f/<token>` (ссылка, прогресс «N из 8») → `/consent` → `/record` (вопрос крупно + озвучка, запись mp4/webm, пауза при блокировке экрана, загрузка файлом, прямой PUT в Storage, `stories` uploaded → `/process` по шагам, уточнения агента I10 голосом с `parent_story_id`). Банк — заглушка 8 вопросов | V0 банк вопросов; ручная проверка на iPhone / Android / планшете |
| Z3 Глава, книга, QR | 🟢 I3 готово | I3: `/chapter/<id>?token=` — разворот RU \| KR (телефон: переключатель), фото, цитата крупно, экран ожидания конвейера (опрос `GET /api/stories/:id`, сам двигает `/process`, «собрать ещё раз»); QR → публичная `/listen/<id>?s=<HMAC>` (без входа, неверная подпись → 404, свой плеер, SSR); «Отправить семье» (Web Share → WhatsApp / Telegram / ссылка); «Скачать QR для слайда»; Noto Serif KR самохостом (`@fontsource`, unicode-range); список глав на `/f/<token>` | I5 книга PDF; проверить QR со слайда на iPhone и Android |
| Z4 Демо-оплата и допы | ⚪ не начато | Порт оплаты demo | I7 |
| Z5 АКНЦ | ⚪ не начато | — | I4 киоск, I9 кабинет |

## Блокеры
- Цены для демо-оплаты из фин. модели (`lib/payments/index.ts`, сейчас 0 ₸) — нужны к I7.
- ~~Сверить актуальные имена моделей~~ → Actions → ai-models (вручную) подбирает и проверяет модели. Бесплатные квоты в сутки задаются входами workflow — сверить с AI Studio → Rate limits.

## Ручные шаги после W0 (Данил)
- [ ] Vercel: импорт репозитория, Environment Variables из `.env.example` (Production + Preview)
- [ ] GitHub Secrets: `SUPABASE_DB_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PROD_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- [ ] Actions → migrate → Run workflow; в Supabase появились 12 таблиц и 4 хранилища
- [ ] Actions → smoke → Run workflow → зелёный; `/api/health` → `"status":"ok","db":"ok"`
- [ ] Защита main: обязательная проверка `ci`
