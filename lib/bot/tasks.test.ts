import { describe, expect, it } from "vitest";
import { buildProgress, buildQueue, buildTasks, closedByPull, fileAreas, findTask, parseDeps, parseFiles, progressBar, type GhIssue, type GhPull } from "./tasks";

function issue(n: number, title: string, opts: Partial<GhIssue> & { deps?: string; zone?: string; files?: string[] } = {}): GhIssue {
  const body = [
    `**Исполнитель:** Codex · **Зона:** ${opts.zone ?? "Z3"}`,
    "## Файлы",
    "```",
    ...(opts.files ?? [`lib/x${n}/*   — что-то`]),
    "```",
    "## Зависит от",
    opts.deps ?? "—",
    "",
    "---",
    "_Источник: docs/issues/I5.md_",
  ].join("\n");
  return {
    number: n,
    title,
    body,
    state: "open",
    html_url: `https://github.com/o/r/issues/${n}`,
    labels: [],
    assignees: [],
    milestone: { number: 1, title: "MLP 27.11" },
    ...opts,
  };
}

describe("разбор issue", () => {
  it("код, зависимости, файлы", () => {
    const i = issue(9, "[I5] Книга PDF", { deps: "I2, I3 (QR)", files: ["lib/book/pdf/*   — документ", "app/book/[token]/page.tsx — экран"] });
    expect(parseDeps(i.body)).toEqual(["I2", "I3"]);
    expect(parseFiles(i.body)).toEqual(["lib/book/pdf/*", "app/book/[token]/page.tsx"]);
    const [t] = buildTasks([i]);
    expect(t).toMatchObject({ code: "I5", name: "Книга PDF", zone: "Z3", status: "todo" });
  });

  it("сводка файлов для промпта", () => {
    expect(fileAreas(["lib/book/pdf/*", "lib/book/build.ts", "app/book/[token]/page.tsx", "app/api/books/[familyId]/build/route.ts"])).toEqual([
      "lib/book",
      "app/book",
      "app/api/books",
    ]);
    expect(fileAreas(["app/(family)/checkout/[token]/page.tsx", "lib/payments/index.ts"])).toEqual(["app/(family)/checkout", "lib/payments"]);
  });

  it("зона из метки важнее текста", () => {
    const [t] = buildTasks([issue(1, "[I1] x", { labels: [{ name: "zone:Z1" }], zone: "Z9" })]);
    expect(t!.zone).toBe("Z1");
  });

  it("PR из выдачи /issues — не задача", () => {
    expect(buildTasks([issue(1, "[I1] x", { pull_request: {} })])).toHaveLength(0);
  });

  it("поиск по коду: из дублей берётся открытый", () => {
    const tasks = buildTasks([issue(10, "[I14] старый", { state: "closed" }), issue(23, "[I14] новый")]);
    expect(findTask(tasks, "i14")?.number).toBe(23);
    expect(findTask(tasks, "#10")?.number).toBe(10);
  });
});

describe("очередь", () => {
  const issues = [
    issue(3, "[I2] конвейер", { state: "closed", zone: "Z2" }),
    issue(8, "[I3] глава", { state: "open", zone: "Z3", assignees: [{ login: "prokodan" }] }),
    issue(9, "[I5] книга", { deps: "I2, I3", zone: "Z3" }),
    issue(11, "[I6] черновик", { deps: "I2", zone: "Z3", labels: [{ name: "critical-path" }] }),
    issue(12, "[I7] оплата", { deps: "W0", zone: "Z4" }),
    issue(7, "[I4] киоск", { deps: "I1", zone: "Z5" }),
    issue(2, "[I1] запись", { state: "closed", zone: "Z1" }),
    issue(14, "[I9] кабинет", { deps: "I4", zone: "Z5" }),
  ];

  it("не предлагает задачу с незакрытой зависимостью", () => {
    const q = buildQueue(buildTasks(issues));
    const codes = q.ready.map((t) => t.code);
    expect(codes).not.toContain("I5"); // ждёт I3
    expect(codes).not.toContain("I9"); // ждёт I4
    expect(codes).not.toContain("I3"); // уже в работе
    expect(codes).toEqual(expect.arrayContaining(["I6", "I7", "I4"]));
    expect(q.blocked.map((t) => t.code).sort()).toEqual(["I5", "I9"]);
  });

  it("группы — по одной задаче на зону, критический путь первым", () => {
    const more = [...issues, issue(13, "[I8] сказка", { zone: "Z4" })];
    const q = buildQueue(buildTasks(more));
    for (const g of q.groups) expect(new Set(g.map((t) => t.zone)).size).toBe(g.length);
    expect(q.groups[0]!.map((t) => t.code)).toEqual(["I6", "I4", "I7"]);
    expect(q.groups[1]!.map((t) => t.code)).toEqual(["I8"]);
  });

  it("неизвестная зависимость (W0) считается выполненной", () => {
    const [t] = buildTasks([issue(12, "[I7] оплата", { deps: "W0" })]);
    expect(t!.status).toBe("todo");
  });
});

describe("прогресс", () => {
  it("совпадает с milestone и знает автора слитого PR", () => {
    const issues = [
      issue(1, "[V0] банк", { state: "closed" }),
      issue(2, "[I1] запись", { state: "closed", assignees: [{ login: "vlad-gh" }] }),
      issue(9, "[I5] книга", { assignees: [{ login: "prokodan" }] }),
      issue(12, "[I7] оплата"),
      issue(29, "[I16] бот", { milestone: null }),
    ];
    const pulls: GhPull[] = [
      { number: 25, title: "I1", body: "Closes #2", state: "closed", html_url: "u", user: { login: "codex-vlad" }, merged_at: "2026-11-22" },
      { number: 30, title: "I5", body: "Closes #9", state: "open", html_url: "u", user: { login: "prokodan" }, merged_at: null },
    ];
    const p = buildProgress(buildTasks(issues), pulls, "MLP 27.11");
    expect(p.total).toBe(4);
    expect(p.done.map((d) => [d.task.code, d.who])).toEqual([
      ["V0", null],
      ["I1", "codex-vlad"],
    ]);
    expect(p.inProgress.map((x) => x.task.code)).toEqual(["I5"]);
    expect(p.left.map((t) => t.code)).toEqual(["I7"]);
    expect(p.openPulls.map((x) => x.number)).toEqual([30]);
  });

  it("Closes / Fixes / Resolves только у слитых PR", () => {
    const base = { number: 1, title: "", state: "closed" as const, html_url: "", user: null };
    expect(closedByPull({ ...base, body: "Closes #8\nfixes #9", merged_at: "x" })).toEqual([8, 9]);
    expect(closedByPull({ ...base, body: "Closes #8", merged_at: null })).toEqual([]);
  });

  it("полоса прогресса", () => {
    expect(progressBar(6, 19)).toBe("▓▓▓▓░░░░░░░░ 6/19");
    expect(progressBar(0, 0)).toBe("░░░░░░░░░░░░ 0/0");
  });
});

describe("метка in-progress у закрытых задач (#69)", () => {
  it("закрытая задача с меткой in-progress — «готово», а не «в работе»", () => {
    const tasks = buildTasks([
      issue(1, "[V0] Банк вопросов", { state: "closed", labels: [{ name: "in-progress" }] }),
      issue(2, "[I9] Кабинет", { labels: [{ name: "in-progress" }] }),
    ]);
    expect(tasks.map((t) => [t.number, t.status])).toEqual([
      [1, "done"],
      [2, "in_progress"],
    ]);
    const p = buildProgress(tasks, [], "MLP 27.11");
    expect(p.inProgress.map((x) => x.task.number)).toEqual([2]);
  });
});
