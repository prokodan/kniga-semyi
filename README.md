# Книга семьи · 우리 이야기

Голос старших — в книге для внуков. Семья записывает рассказы бабушки или дедушки, ИИ делает главы на русском и
корейском, собирается книга в PDF с QR на живой голос. MLP для полуфинала Startup-Nunchi (АКНЦ), 27.11.2026.

## Быстрый старт
```bash
npm install
npm run dev        # http://localhost:3000 — без ключей работает заглушка ИИ (AI_MODE=mock)
npm run check      # типы, линтер, тесты, миграции в PGlite
```
Переменные — `.env.example` (локально копия в `.env.local`; в проде — Vercel Env и GitHub Secrets).

## Для агентов и людей
- Правила: [`AGENTS.md`](AGENTS.md) (Claude Code, Codex, Gemini читают его же)
- Продукт: [`docs/PRODUCT.md`](docs/PRODUCT.md) · Архитектура: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Решения: [`docs/DECISIONS.md`](docs/DECISIONS.md) · Статус: [`docs/STATUS.md`](docs/STATUS.md)
- Задачи: GitHub Issues (шаблон «Задача»), одна задача = одна ветка = один PR

## Автоматизация
| Workflow | Когда | Что делает |
| --- | --- | --- |
| `ci` | каждый PR и push в main | typecheck, lint, test, миграции в PGlite, build |
| `migrate` | слияние в main с новыми миграциями, вручную | `supabase db push` в прод-базу |
| `smoke` | ежедневно 07:23 Алматы, вручную | `/api/health`, таблицы и хранилища Supabase |
| `notify` | PR открыт / готов, деплой прода | сообщение в Telegram |

Telegram-уведомления включаются секретами `TELEGRAM_BOT_TOKEN` и `TELEGRAM_CHAT_ID`; без них шаги пропускаются.
