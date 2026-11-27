// Разбор задач из GitHub Issues: код [I5], «## Зависит от», зона, исполнитель, статус.
// Чистые функции без сети — их и проверяют тесты.

export type GhLabel = { name: string };
export type GhUser = { login: string };
export type GhIssue = {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  html_url: string;
  labels: GhLabel[];
  assignees: GhUser[];
  milestone: { number: number; title: string } | null;
  /** Есть у PR в выдаче /issues — такие записи задачами не считаем. */
  pull_request?: unknown;
  closed_at?: string | null;
};
export type GhPull = {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  draft?: boolean;
  html_url: string;
  user: GhUser | null;
  merged_at: string | null;
  created_at?: string;
};

export type TaskStatus = "done" | "in_progress" | "todo" | "blocked";

export type Task = {
  number: number;
  code: string | null;
  title: string;
  /** Заголовок без кода: «Книга PDF A5…». */
  name: string;
  url: string;
  state: "open" | "closed";
  zone: string | null;
  owner: string | null;
  assignees: string[];
  deps: string[];
  files: string[];
  labels: string[];
  milestone: string | null;
  status: TaskStatus;
  /** Коды зависимостей, которые ещё открыты. */
  openDeps: string[];
};

export const IN_PROGRESS_LABEL = "in-progress";

// Код задачи MLP ([I5], [V2]); [Z6] — это зона, а не код (#212).
const CODE_RE = /\[([A-Y]\d+)\]/;
/** Ведущие пометки в заголовке: «[Z6] », «[Z1/Z5] », «[I5] ». */
const TAGS_RE = /^(?:\s*\[[^\]]{1,12}\])+\s*/;
const DEP_CODE_RE = /\b([A-Z]\d+)\b/g;

export function parseCode(title: string): string | null {
  return CODE_RE.exec(title)?.[1] ?? null;
}

/** Текст раздела `## Заголовок` до следующего `## ` или `---`. */
export function section(body: string | null, heading: string): string | null {
  if (!body) return null;
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start < 0) return null;
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (/^##\s/.test(l) || /^---\s*$/.test(l)) break;
    out.push(l);
  }
  return out.join("\n").trim();
}

export function parseDeps(body: string | null): string[] {
  const s = section(body, "Зависит от");
  if (!s) return [];
  return [...new Set([...s.matchAll(DEP_CODE_RE)].map((m) => m[1]!))];
}

/** Пути из блока кода в разделе «Файлы» — первая «слово» каждой строки. */
export function parseFiles(body: string | null): string[] {
  const s = section(body, "Файлы");
  if (!s) return [];
  return s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("```"))
    .map((l) => l.split(/\s+/)[0]!)
    .filter((p) => /[/.]/.test(p));
}

/** Короткая сводка файлов для промпта: «lib/book, app/book». */
export function fileAreas(files: string[]): string[] {
  const areas = files.map((f) => {
    const parts = f.replace(/\/\*.*$/, "").split("/").filter(Boolean);
    if (parts.length > 1 && /\.[a-z0-9]+$/i.test(parts.at(-1)!)) parts.pop(); // файл → его папка
    // app/api/x, app/(family)/x — глубже на один уровень, иначе всё сливается в «app/api»
    const depth = parts[1] === "api" || /^\(.+\)$/.test(parts[1] ?? "") || parts[0] === ".github" ? 3 : 2;
    return parts.slice(0, depth).join("/");
  });
  return [...new Set(areas.filter(Boolean))];
}

export function parseZone(labels: string[], body: string | null): string | null {
  const fromLabel = labels.find((l) => /^zone:Z\d+$/i.test(l));
  if (fromLabel) return fromLabel.slice(5).toUpperCase();
  const m = /\*\*Зона:\*\*\s*(Z\d+)/i.exec(body ?? "");
  return m ? m[1]!.toUpperCase() : null;
}

export function parseOwner(labels: string[]): string | null {
  return labels.find((l) => l.startsWith("owner:"))?.slice(6) ?? null;
}

/** Issues → задачи со статусами. PR из выдачи /issues отбрасываются. */
export function buildTasks(issues: GhIssue[]): Task[] {
  const real = issues.filter((i) => !i.pull_request);
  // Зависимость не закрыта, если есть ОТКРЫТАЯ задача с этим кодом. Неизвестный код (W0 — каркас без issue)
  // и коды, у которых все дубли закрыты, считаем выполненными.
  const openCodes = new Set(real.filter((i) => i.state === "open").map((i) => parseCode(i.title)).filter(Boolean));
  return real.map((i) => {
    const labels = i.labels.map((l) => l.name);
    const code = parseCode(i.title);
    const deps = parseDeps(i.body).filter((d) => d !== code);
    const openDeps = deps.filter((d) => openCodes.has(d));
    const assignees = i.assignees.map((a) => a.login);
    let status: TaskStatus;
    if (i.state === "closed") status = "done";
    else if (assignees.length > 0 || labels.includes(IN_PROGRESS_LABEL)) status = "in_progress";
    else if (openDeps.length > 0) status = "blocked";
    else status = "todo";
    return {
      number: i.number,
      code,
      title: i.title,
      name: i.title.replace(CODE_RE, "").replace(TAGS_RE, "").trim(),
      url: i.html_url,
      state: i.state,
      zone: parseZone(labels, i.body),
      owner: parseOwner(labels),
      assignees,
      deps,
      files: parseFiles(i.body),
      labels,
      milestone: i.milestone?.title ?? null,
      status,
      openDeps,
    };
  });
}

export function findTask(tasks: Task[], ref: string): Task | undefined {
  const r = ref.trim().replace(/^#/, "").toUpperCase();
  if (/^\d+$/.test(r)) return tasks.find((t) => t.number === Number(r));
  // Из дублей с одним кодом берём открытый, иначе самый новый.
  const same = tasks.filter((t) => t.code === r).sort((a, b) => b.number - a.number);
  return same.find((t) => t.state === "open") ?? same[0];
}

/** Номера issues, которые закрывает слитый PR (Closes / Fixes / Resolves #N). */
export function closedByPull(pull: GhPull): number[] {
  if (!pull.merged_at || !pull.body) return [];
  return [...pull.body.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi)].map((m) => Number(m[1]));
}

export type Progress = {
  total: number;
  done: { task: Task; who: string | null }[];
  inProgress: { task: Task; who: string[] }[];
  openPulls: GhPull[];
  left: Task[];
};

export function buildProgress(tasks: Task[], pulls: GhPull[], milestone: string): Progress {
  const mine = tasks.filter((t) => t.milestone === milestone);
  const author = new Map<number, string>();
  for (const p of pulls) for (const n of closedByPull(p)) if (p.user) author.set(n, p.user.login);
  const done = mine
    .filter((t) => t.status === "done")
    .map((task) => ({ task, who: author.get(task.number) ?? task.assignees[0] ?? null }));
  const inProgress = mine.filter((t) => t.status === "in_progress").map((task) => ({ task, who: task.assignees }));
  const left = mine.filter((t) => t.status === "todo" || t.status === "blocked");
  const openPulls = pulls.filter((p) => p.state === "open");
  return { total: mine.length, done, inProgress, openPulls, left };
}

export function progressBar(done: number, total: number, width = 12): string {
  const filled = total > 0 ? Math.round((done / total) * width) : 0;
  return `${"▓".repeat(filled)}${"░".repeat(width - filled)} ${done}/${total}`;
}

const DAY_ORDER = ["day:W0", "day:W1", "day:W2", "day:W3"];

function priority(t: Task): number {
  const crit = t.labels.includes("critical-path") ? 0 : 1;
  const day = DAY_ORDER.findIndex((d) => t.labels.includes(d));
  const cut = t.labels.includes("can-cut") ? 1 : 0;
  return crit * 1000 + (day < 0 ? 9 : day) * 100 + cut * 10;
}

export type Queue = {
  ready: Task[];
  /** Группа k — по одной задаче из каждой зоны; внутри группы можно брать параллельно. */
  groups: Task[][];
  blocked: Task[];
};

/** Задачи людей и вопросы — не для агента: в очередь «Взять» не попадают (#212). */
const NOT_FOR_AGENT = ["owner:human", "question", "wontfix", "duplicate", "invalid"];
export const isForAgent = (t: Task) => !t.labels.some((l) => NOT_FOR_AGENT.includes(l));

/** Очередь: открытые, без исполнителя, все «Зависит от» закрыты, не задачи людей. Свежие — выше. */
export function buildQueue(tasks: Task[]): Queue {
  const ready = tasks
    .filter((t) => t.status === "todo" && isForAgent(t))
    .sort((a, b) => priority(a) - priority(b) || b.number - a.number);
  // Готовые задачи не зависят друг от друга (зависимость от открытой задачи = не готова),
  // поэтому для параллельности достаточно развести их по разным зонам.
  const byZone = new Map<string, Task[]>();
  for (const t of ready) {
    const z = t.zone ?? `#${t.number}`;
    byZone.set(z, [...(byZone.get(z) ?? []), t]);
  }
  const groups: Task[][] = [];
  for (const list of byZone.values()) {
    list.forEach((t, k) => {
      (groups[k] ??= []).push(t);
    });
  }
  const blocked = tasks.filter((t) => t.status === "blocked");
  return { ready, groups, blocked };
}

/** Обзор по открытым issues (#212): вместо старых кодов задач MLP (I, W, V) и milestone. */
export type Overview = {
  open: number;
  byZone: { zone: string; count: number }[];
  inProgress: Task[];
  human: Task[];
  /** Без milestone — «после питча» / v2. */
  later: number;
  closedWeek: number;
  openPulls: { pull: GhPull; hours: number | null }[];
};

export function buildOverview(issues: GhIssue[], pulls: GhPull[], now: Date): Overview {
  const tasks = buildTasks(issues);
  const open = tasks.filter((t) => t.state === "open");
  const zones = new Map<string, number>();
  for (const t of open) {
    const zs = t.labels.filter((l) => /^zone:Z\d+$/i.test(l)).map((l) => l.slice(5).toUpperCase());
    for (const z of zs.length ? zs : [t.zone ?? "без зоны"]) zones.set(z, (zones.get(z) ?? 0) + 1);
  }
  const weekAgo = now.getTime() - 7 * 86_400_000;
  const closedWeek = issues.filter(
    (i) => !i.pull_request && i.state === "closed" && i.closed_at && new Date(i.closed_at).getTime() >= weekAgo,
  ).length;
  const hours = (iso?: string) => (iso ? Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 3_600_000)) : null);
  return {
    open: open.length,
    byZone: [...zones].map(([zone, count]) => ({ zone, count })).sort((a, b) => a.zone.localeCompare(b.zone)),
    inProgress: open.filter((t) => t.status === "in_progress"),
    human: open.filter((t) => t.labels.includes("owner:human")),
    later: open.filter((t) => !t.milestone).length,
    closedWeek,
    openPulls: pulls.filter((p) => p.state === "open").map((pull) => ({ pull, hours: hours(pull.created_at) })),
  };
}
