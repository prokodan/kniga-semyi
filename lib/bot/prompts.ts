// Промпт задачи — строго по docs/HANDOFF.md §7 (один источник правды, #212). Бот читает §7 из main и подставляет
// #N, название, кто берёт, «Доп. данные» (раздел issue «## Для промпта») и «Параллельно работают» (другие задачи
// in-progress и их папки). Если файл не прочитался — запасная копия ниже; тест сверяет её с HANDOFF.md.
import type { Role } from "./store";
import { fileAreas, section, type Task } from "./tasks";

export const HANDOFF_PATH = "docs/HANDOFF.md";

/** Запасная копия шаблона §7 — должна совпадать с docs/HANDOFF.md (тест handler.test.ts). */
export const FALLBACK_TEMPLATE = `Проект «Книга семьи», репозиторий prokodan/kniga-semyi (add_repo, access push).
Я — <Данил | Влад>. Сделай issue #<N> (<название>). Начни с AGENTS.md, своей issue и docs/STATUS.md; контекст и правила команды — docs/HANDOFF.md (§3 обязателен).
<Доп. данные, если есть>
Параллельно работают: <issues и их папки> — их файлы не трогай.
В конце: PR через GitHub REST API (GraphQL недоступен) с Closes #<N>, в описании PR — строка «Флаг: <имя из lib/flags> | не нужен — <почему>» (проверяет CI flag-line) и раздел «📝 Заметки для команды»; каждое «осталось / потом / руками» — отдельная issue со ссылкой в заметках; дождись зелёных ci, e2e и flag-line (для prompts/ — ещё eval без 🔴 по фактам) и сам слей PR (squash); после — migrate / smoke / seed-demo по необходимости через workflow_dispatch. В чат — копия заметок + «Итог простыми словами» + что проверить с телефона (точные ссылки) + следующие задачи (независимые — пометь для параллельного запуска).
Если я напишу «лимиты кончаются» — закоммить всё в ветку, открой черновой PR «Сделано / Осталось / Как продолжить» и остановись.`;

const PLACEHOLDERS = ["<Данил | Влад>", "#<N>", "<название>", "<Доп. данные, если есть>", "<issues и их папки>"];

/** Первый блок ``` после заголовка «## 7.» в HANDOFF.md; null — если раздел не нашёлся или шаблон сломан. */
export function templateFromHandoff(md: string | null): string | null {
  if (!md) return null;
  const at = md.search(/^## 7\./m);
  if (at < 0) return null;
  const m = /```[^\n]*\n([\s\S]*?)\n```/.exec(md.slice(at));
  const tpl = m?.[1]?.trim();
  return tpl && PLACEHOLDERS.every((p) => tpl.includes(p)) ? tpl : null;
}

export function roleForOwner(owner: string | null): Role {
  return owner === "codex" ? "vlad" : "danil";
}

const ROLE_NAME: Record<Role, string> = { danil: "Данил", vlad: "Влад" };

/** «#211 (lib/ai, app/admin/ai), #208» — другие задачи в работе и их папки. */
export function parallelList(task: Task, all: Task[]): string | null {
  const list = all
    .filter((t) => t.number !== task.number && t.status === "in_progress" && t.state === "open")
    .map((t) => {
      const areas = fileAreas(t.files);
      return `#${t.number}${areas.length ? ` (${areas.join(", ")})` : ""}`;
    });
  return list.length ? list.join(", ") : null;
}

export function buildPrompt(
  role: Role,
  task: Task,
  all: Task[],
  body: string | null,
  repo: string,
  template: string = FALLBACK_TEMPLATE,
): string {
  const extra = section(body, "Для промпта");
  const parallel = parallelList(task, all);
  return template
    .replace("prokodan/kniga-semyi", repo)
    .replace("<Данил | Влад>", ROLE_NAME[role])
    .replaceAll("#<N>", `#${task.number}`)
    .replace("<название>", task.name)
    .split("\n")
    .flatMap((line) => {
      if (line.includes("<Доп. данные, если есть>")) return extra ? [line.replace("<Доп. данные, если есть>", extra)] : [];
      if (line.includes("<issues и их папки>")) return parallel ? [line.replace("<issues и их папки>", parallel)] : [];
      return [line];
    })
    .join("\n");
}
