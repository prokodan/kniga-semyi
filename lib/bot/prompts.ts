// Готовые промпты для «Взять» / /prompt: Данилу — шаблон Claude, Владу — шаблон Codex.
// Доп. данные задачи (цены I7 и т.п.) берутся из раздела issue «## Для промпта» или из EXTRA ниже.
import type { Role } from "./store";
import { fileAreas, section, type Task } from "./tasks";

/** Дополнения к промпту по коду задачи, если их нет в самой issue. */
export const EXTRA: Record<string, string> = {
  I7: "Цены — только в PRICES_KZT / EXTRAS_KZT (lib/payments/index.ts), из финмодели. Если в issue их нет — спроси Данила, не придумывай.",
};

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
          `Сделай задачу ${code} (${task.name}) из GitHub Issues репозитория ${repo}, issue #${task.number}.`,
          "Следуй AGENTS.md, работай только с файлами из раздела «Файлы» задачи, новая таблица — сразу grant для service_role, перед PR запусти npm run check.",
          parallelLine(task, all),
          extras(task, body),
          `В PR: что сделано, какие переменные и секреты нужно добавить (только имена), как проверить, Closes #${task.number}. В конце ответа — «Итог простыми словами».`,
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
          "6. Номер PR напиши Данилу в группу.",
        ];
  return lines.filter(Boolean).join("\n");
}
