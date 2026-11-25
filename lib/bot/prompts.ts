// Готовые промпты для «Взять» / /prompt: Данилу — шаблон Claude, Владу — шаблон Codex.
// Доп. данные задачи (цены I7 и т.п.) берутся из раздела issue «## Для промпта» или из EXTRA ниже.
import type { Role } from "./store";
import { fileAreas, section, type Task } from "./tasks";

/** Дополнения к промпту по коду задачи, если их нет в самой issue. */
export const EXTRA: Record<string, string> = {
  I7: "Цены — только в PRICES_KZT / EXTRAS_KZT (lib/payments/index.ts), из финмодели. Если в issue их нет — спроси Данила, не придумывай.",
  V0: "Банк для пожилых корё-сарам 70–90 лет, говорят в основном по-русски: тёплые вопросы на «вы», простые слова, одна мысль в вопросе, внутри блока — от лёгкого к личному, трудные темы (депортация, война, потери) — бережно, с возможностью не отвечать. Корейский — простой уважительный стиль (요/습니다). Формат — тот, что уже читает интервью-агент (content/questions, PR #22), код агента не меняй. Рядом — шпаргалка RU | KR одной таблицей для проверки человеком.",
  V1: "Автоматизируй: гоняй симулятор I15 (npm run sim, лимит запросов) и оценку, правь prompts/*.md и оставляй правку, только если отчёт стал лучше (меньше потерянных/искажённых фактов, голос рассказчика сохранён). Приложи отчёты до/после.",
  V2: "Автоматизируй: обратный перевод KR→RU моделью другого провайдера и сравнение с RU, проверка вежливых форм; флажки на сомнительных местах. Человеку — только короткий список флажков по 1–2 демо-главам.",
  I11: "Включи проверку корейского обратным переводом (KR→RU другой моделью) с флажками сомнительных мест.",
};

/** Шапка промпта для нового чата Claude: подключение репозитория. */
const CLAUDE_HEAD = (repo: string) => `Проект «Книга семьи», репозиторий ${repo} (add_repo, access push).`;

/** Хвост промпта Claude: агент сам доводит PR до main и подсказывает следующую волну. */
const CLAUDE_TAIL = [
  "В конце:",
  "1) открой PR через GitHub REST API (GraphQL недоступен), обнови строку своей зоны в docs/STATUS.md;",
  "2) дождись зелёного ci; при конфликте с main влей main в ветку и разреши; сам слей PR (squash) — Данил разрешает, несмотря на правило в AGENTS.md; если нужен workflow (migrate, smoke, ai-models) — запусти через workflow_dispatch и дождись результата;",
  "3) напиши, что проверить Данилу с телефона (1–2 действия, точная ссылка);",
  "4) блок «Итог простыми словами»: что сделали, частью чего это является, сколько задач milestone «MLP 27.11» закрыто;",
  "5) подскажи следующие задачи из очереди; независимые — пометь для параллельного запуска.",
  "Если Данил напишет «лимиты кончаются» — закоммить всё в ветку, открой черновой PR «Сделано / Осталось / Как продолжить» и остановись.",
];

export function roleForOwner(owner: string | null): Role {
  return owner === "codex" ? "vlad" : "danil";
}

function parallelLine(task: Task, others: Task[]): string | null {
  const list = others
    .filter((t) => t.number !== task.number && t.status === "in_progress")
    .map((t) => {
      const areas = fileAreas(t.files);
      return `${t.code ?? `#${t.number}`}${areas.length ? ` (${areas.join(", ")})` : ""}`;
    });
  return list.length ? `Параллельно другие агенты делают ${list.join(", ")} — их файлы не трогай.` : null;
}

function extras(task: Task, body: string | null): string | null {
  const parts = [section(body, "Для промпта"), task.code ? EXTRA[task.code] : undefined].filter(Boolean);
  return parts.length ? parts.join("\n") : null;
}

export function buildPrompt(role: Role, task: Task, all: Task[], body: string | null, repo: string): string {
  const code = task.code ?? `#${task.number}`;
  const zone = task.zone ? task.zone.replace(/^Z/, "") : "N";
  const lines =
    role === "danil"
      ? [
          CLAUDE_HEAD(repo),
          `Сделай задачу ${code} (${task.name}), issue #${task.number}. Начни с AGENTS.md и docs/STATUS.md, работай только с файлами из раздела «Файлы» задачи, новая таблица — сразу grant для service_role, перед PR запусти npm run check.`,
          extras(task, body),
          parallelLine(task, all),
          `В PR: что сделано, какие переменные и секреты нужно добавить (только имена), как проверить, Closes #${task.number}.`,
          ...CLAUDE_TAIL,
        ]
      : [
          `Задача ${code} «${task.name}» — issue #${task.number} в репозитории ${repo}.`,
          "1. Прочитай AGENTS.md, issue и docs/STATUS.md. Больше ничего заранее не читай.",
          "2. Работай только с файлами из раздела «Файлы» issue. Общие файлы Z6 не меняй — опиши правку в PR.",
          `3. Ветка z${zone}/кратко-о-задаче. Всё должно работать в AI_MODE=mock, без ключей.`,
          parallelLine(task, all),
          extras(task, body),
          "4. Перед PR: npm run check — зелёный.",
          `5. Create PR по шаблону: что сделано, как проверить, что осталось, Closes #${task.number}. Обнови строку своей зоны в docs/STATUS.md.`,
          "6. Номер PR напиши Данилу в группу. В конце ответа — «Итог простыми словами» (2–3 предложения без терминов).",
        ];
  return lines.filter(Boolean).join("\n");
}
