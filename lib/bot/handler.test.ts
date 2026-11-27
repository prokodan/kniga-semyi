import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { parseMilestones, type BotConfig } from "./config";
import type { DigestStats } from "./digest";
import { aiLine, buildDigest, greeting, redChecks } from "./digest";
import { createGithub, type GhRun, type GithubApi, type Preview } from "./github";
import { createBot } from "./handler";
import { DEFAULT_PREFS, decide, isQuietTime } from "./notify";
import { FALLBACK_TEMPLATE, templateFromHandoff } from "./prompts";
import { MemoryBotStore } from "./store";
import { buildOverview, type GhIssue, type GhPull } from "./tasks";
import type { SendOptions, TelegramApi, TgUpdate } from "./telegram";

const GROUP = -1001234567890;

const cfg: BotConfig = {
  telegramToken: "123:SECRET-TOKEN",
  chatId: String(GROUP),
  webhookSecret: "wh",
  notifySecret: "ns",
  githubToken: "ghp_test",
  repo: "prokodan/kniga-semyi",
  prodUrl: "https://kniga.example",
  vercelUrl: "https://vercel.com/prokodan/kniga-semyi",
  milestones: parseMilestones(undefined),
};

const DEMO_TOKEN = "demo-token-secret-123";

type Sent = { chatId: number | string; html: string; opts?: SendOptions };

class FakeTg implements TelegramApi {
  sent: Sent[] = [];
  answers: string[] = [];
  async send(chatId: number | string, html: string, opts?: SendOptions) {
    this.sent.push({ chatId, html, opts });
  }
  async edit(chatId: number | string, _id: number, html: string, opts?: SendOptions) {
    this.sent.push({ chatId, html, opts });
  }
  async answer(id: string) {
    this.answers.push(id);
  }
}

function body(deps: string, zone: string) {
  return `**Зона:** ${zone}\n## Файлы\n\`\`\`\nlib/book/pdf/* — x\n\`\`\`\n## Зависит от\n${deps}\n`;
}
const ISSUES: GhIssue[] = [
  { number: 9, title: "[I5] Книга PDF", body: body("I2", "Z3"), state: "open", html_url: "u9", labels: [{ name: "owner:claude" }], assignees: [], milestone: { number: 1, title: "MLP 27.11" } },
  { number: 12, title: "[I7] Демо-оплата", body: body("W0", "Z4") + "## Для промпта\nЦены — только из PRICES_KZT.\n", state: "open", html_url: "u12", labels: [{ name: "owner:codex" }], assignees: [], milestone: { number: 1, title: "MLP 27.11" } },
  { number: 20, title: "[Z6] Носителю: вычитать корейский", body: body("—", "Z6"), state: "open", html_url: "u20", labels: [{ name: "owner:human" }, { name: "zone:Z6" }], assignees: [], milestone: null },
  { number: 11, title: "[I6] Черновик", body: body("I5", "Z3"), state: "open", html_url: "u11", labels: [], assignees: [], milestone: { number: 1, title: "MLP 27.11" } },
  { number: 3, title: "[I2] Конвейер", body: body("—", "Z2"), state: "closed", html_url: "u3", labels: [], assignees: [], milestone: { number: 1, title: "MLP 27.11" } },
];

class FakeGh implements GithubApi {
  repo = cfg.repo;
  issues = structuredClone(ISSUES);
  calls: string[] = [];
  runs: GhRun[] = [];
  preview: Preview | null = null;
  handoff: string | null = null;
  constructor(public canWrite = true) {}
  async listMainRuns() {
    return this.runs;
  }
  async latestPreview() {
    return this.preview;
  }
  async readFile() {
    return this.handoff;
  }
  async listIssues() {
    return this.issues;
  }
  async listPulls(): Promise<GhPull[]> {
    return [];
  }
  async findMilestone() {
    return null;
  }
  async assign(n: number, login: string) {
    this.calls.push(`assign ${n} ${login}`);
    const i = this.issues.find((x) => x.number === n)!;
    i.assignees.push({ login });
    return i.assignees.map((a) => a.login);
  }
  async unassign(n: number, login: string) {
    this.calls.push(`unassign ${n} ${login}`);
  }
  async addLabel(n: number, label: string) {
    this.calls.push(`label ${n} ${label}`);
  }
  async removeLabel(n: number, label: string) {
    this.calls.push(`unlabel ${n} ${label}`);
  }
  async dispatch(wf: string) {
    this.calls.push(`dispatch ${wf}`);
  }
}

const msg = (chatId: number, fromId: number, text: string, type: "private" | "supergroup" = "supergroup"): TgUpdate => ({
  update_id: 1,
  message: { message_id: 1, chat: { id: chatId, type }, from: { id: fromId, first_name: "Данил" }, text },
});
const press = (chatId: number, fromId: number, data: string): TgUpdate => ({
  update_id: 2,
  callback_query: { id: "cb", from: { id: fromId, first_name: "Влад" }, data, message: { message_id: 5, chat: { id: chatId, type: "supergroup" } } },
});

let tg: FakeTg, gh: FakeGh, store: MemoryBotStore;
const NOON = new Date("2026-11-23T07:00:00Z"); // 12:00 Алматы

const STATS: DigestStats = {
  ai: { prod: { yesterday: 0.25, today: 0.1, month: 1.75 } },
  budget: { day: 2, month: 10 },
  stuck: { count: 0, oldest_min: null },
  new_families: 0,
};
let stats: DigestStats | null = STATS;
let previewEnv: string | null = null;

function bot(over: Partial<{ gh: GithubApi; now: Date }> = {}) {
  return createBot({
    cfg,
    tg,
    gh: over.gh ?? gh,
    store,
    now: () => over.now ?? NOON,
    ops: {
      stats: async () => stats,
      demoFamilies: async () => [
        { name: "Семья Ким · пример", token: DEMO_TOKEN, source: "family" },
        { name: "Ли Нина · пример", token: "kiosk-token-456", source: "kiosk" },
      ],
    },
    fetchUrlHealth: async () => ({ ok: true, http: 200, json: previewEnv ? { status: "ok", env: previewEnv } : { status: "ok" } }),
  });
}

beforeEach(async () => {
  tg = new FakeTg();
  gh = new FakeGh();
  store = new MemoryBotStore();
  stats = STATS;
  previewEnv = null;
  await store.upsertUser({ tg_id: 1, name: "Данил", github_login: "prokodan", role: "danil" });
  await store.upsertUser({ tg_id: 2, name: "Влад", github_login: "vlad-gh", role: "vlad" });
});

describe("доступ", () => {
  it("отвечает в группе и в личке участника", async () => {
    await bot().handleUpdate(msg(GROUP, 1, "/menu@kniga_bot"));
    await bot().handleUpdate(msg(2, 2, "/menu", "private"));
    expect(tg.sent).toHaveLength(2);
  });

  it("чужим — молчит: другая группа и личка незнакомца", async () => {
    await bot().handleUpdate(msg(-100999, 1, "/menu"));
    await bot().handleUpdate(msg(777, 777, "/menu", "private"));
    await bot().handleUpdate(press(-100999, 1, "queue"));
    expect(tg.sent).toHaveLength(0);
    expect(tg.answers).toHaveLength(0);
  });

  it("первый вход в группе: спрашивает «Данил или Влад?», потом логин", async () => {
    await bot().handleUpdate(msg(GROUP, 55, "/menu"));
    expect(tg.sent[0]!.html).toContain("Данил или Влад");
    await bot().handleUpdate(press(GROUP, 55, "role:vlad"));
    expect((await store.getUser(55))?.role).toBe("vlad");
    await bot().handleUpdate(msg(GROUP, 55, "/iam vlad-real"));
    expect((await store.getUser(55))?.github_login).toBe("vlad-real");
  });
});

describe("взять задачу", () => {
  it("назначает issue, ставит in-progress и шлёт промпт Codex Владу", async () => {
    await bot().handleUpdate(press(GROUP, 2, "take:12"));
    expect(gh.calls).toEqual(["assign 12 vlad-gh", "label 12 in-progress"]);
    const last = tg.sent.at(-1)!.html;
    expect(last).toContain("Я — Влад. Сделай issue #12 (Демо-оплата)");
    expect(last).toContain("Closes #12");
    expect(last).toContain("PRICES_KZT"); // «## Для промпта» из issue
    expect(last).not.toContain("<Доп. данные");
  });

  it("Данилу — шаблон Claude, с задачами в работе у других", async () => {
    await bot().handleUpdate(press(GROUP, 2, "take:12"));
    await bot().handleUpdate(msg(GROUP, 1, "/take I5"));
    const last = tg.sent.at(-1)!.html;
    expect(last).toContain("Я — Данил. Сделай issue #9 (Книга PDF)");
    expect(last).toContain("Итог простыми словами");
    expect(last).toContain("Параллельно работают: #12 (lib/book) — их файлы не трогай.");
    expect(last).not.toContain("<issues");
  });

  it("не даёт взять задачу с незакрытой зависимостью", async () => {
    await bot().handleUpdate(msg(GROUP, 1, "/take I6"));
    expect(gh.calls).toEqual([]);
    expect(tg.sent.at(-1)!.html).toContain("не закрыты I5");
  });

  it("без GITHUB_TOKEN объясняет, что нужно добавить токен", async () => {
    const ro = createGithub({ repo: cfg.repo, fetchImpl: async () => new Response("[]") });
    await bot({ gh: ro }).handleUpdate(msg(GROUP, 1, "/take I5"));
    expect(tg.sent.at(-1)!.html).toContain("GITHUB_TOKEN");
  });

  it("/prompt работает и без токена", async () => {
    await bot({ gh: new FakeGh(false) }).handleUpdate(msg(GROUP, 1, "/prompt I7"));
    expect(tg.sent.at(-1)!.html).toContain("Сделай issue #12");
    expect(tg.sent.at(-1)!.html).not.toContain("Параллельно работают"); // никого в работе — строки нет
  });

  it("/release снимает исполнителя и метку", async () => {
    await bot().handleUpdate(msg(GROUP, 1, "/release I5"));
    expect(gh.calls).toEqual(["unassign 9 prokodan", "unlabel 9 in-progress"]);
  });
});

describe("уведомления", () => {
  it("выключенное уведомление не приходит", async () => {
    await bot().handleUpdate(press(GROUP, 1, "pref:ci_failed"));
    expect((await store.getPrefs(cfg.chatId!)).ci_failed).toBe(false);
    const r = await bot().handleNotify({ event: "ci_failed", text: "🔴 CI упал на main" });
    expect(r.delivered).toBe(false);
    expect(tg.sent.filter((s) => s.html.includes("CI упал на main"))).toHaveLength(0);
  });

  it("включённое — приходит в группу, ночью без звука", async () => {
    const night = new Date("2026-11-23T19:00:00Z"); // 00:00 Алматы
    const r = await bot({ now: night }).handleNotify({ event: "pr_opened", text: "👀 PR #30 <script>", url: "https://github.com/x/pull/30" });
    expect(r).toEqual({ delivered: true, silent: true });
    expect(tg.sent[0]!.chatId).toBe(cfg.chatId);
    expect(tg.sent[0]!.html).toContain("&lt;script&gt;");
    expect(tg.sent[0]!.opts?.silent).toBe(true);
  });

  it("сводка собирается ботом: приветствие по времени Алматы, дела людей, расход ИИ", async () => {
    const r = await bot({ now: new Date("2026-11-27T04:00:00Z") }).handleNotify({ event: "digest" });
    expect(r.delivered).toBe(true);
    const html = tg.sent[0]!.html;
    expect(html).toContain("Доброе утро");
    expect(html).toContain("Видео полуфинала (27.11 23:59)");
    expect(html).toContain("Дела людей (1)");
    expect(html).toContain("ИИ: вчера $0.25 · месяц $1.75 из $10 (18%)");
    expect(html).not.toContain(DEMO_TOKEN);
  });

  it("опоздавшая сводка не говорит «доброе утро» вечером", async () => {
    await bot({ now: new Date("2026-11-27T13:38:00Z") }).handleNotify({ event: "digest" }); // 18:38 Алматы
    expect(tg.sent[0]!.html).toContain("Добрый вечер");
    expect(tg.sent[0]!.html).not.toContain("Доброе утро");
  });

  it("тихие часы 23:00–08:00 Алматы", () => {
    expect(isQuietTime(new Date("2026-11-23T18:00:00Z"))).toBe(true); // 23:00
    expect(isQuietTime(new Date("2026-11-23T02:59:00Z"))).toBe(true); // 07:59
    expect(isQuietTime(new Date("2026-11-23T04:00:00Z"))).toBe(false); // 09:00 — сводка
    expect(decide("digest", { ...DEFAULT_PREFS, digest: false }, NOON)).toMatchObject({ deliver: false });
  });
});

describe("секреты", () => {
  it("токены не попадают в сообщения даже при ошибке", async () => {
    const broken = new FakeGh();
    broken.listIssues = async () => {
      throw new Error("GitHub 500: boom");
    };
    await bot({ gh: broken }).handleUpdate(press(GROUP, 1, "queue"));
    const all = tg.sent.map((s) => s.html).join("\n");
    expect(all).toContain("Не получилось");
    expect(all).not.toContain(cfg.telegramToken!);
    expect(all).not.toContain(cfg.githubToken!);
  });
});

describe("промпт по HANDOFF §7 (#212)", () => {
  it("запасная копия шаблона совпадает с docs/HANDOFF.md", () => {
    const md = readFileSync("docs/HANDOFF.md", "utf8");
    expect(templateFromHandoff(md)).toBe(FALLBACK_TEMPLATE);
  });

  it("берёт шаблон из HANDOFF в main, если он прочитался", async () => {
    gh.handoff = "## 7. Промпт\n```\nНОВОЕ <Данил | Влад> #<N> (<название>)\n<Доп. данные, если есть>\nПараллельно работают: <issues и их папки> — их файлы не трогай.\nCloses #<N>\n```\n";
    await bot().handleUpdate(msg(GROUP, 1, "/prompt 9"));
    const last = tg.sent.at(-1)!.html;
    expect(last).toContain("НОВОЕ Данил #9 (Книга PDF)");
    expect(last).toContain("Closes #9");
  });

  it("сломанный шаблон в HANDOFF → запасная копия", async () => {
    gh.handoff = "## 7. Промпт\n```\nбез плейсхолдеров\n```\n";
    await bot().handleUpdate(msg(GROUP, 1, "/prompt 9"));
    expect(tg.sent.at(-1)!.html).toContain("Я — Данил. Сделай issue #9");
  });
});

describe("очередь (#212)", () => {
  it("задачи людей (owner:human) не предлагаются «Взять»", async () => {
    await bot().handleUpdate(press(GROUP, 1, "queue"));
    const sent = tg.sent.at(-1)!;
    expect(sent.html).not.toContain("Носителю");
    expect(JSON.stringify(sent.opts?.keyboard)).not.toContain("take:20");
  });
});

describe("ссылки (#212)", () => {
  it("в группе — без токенов демо, с подсказкой про личку", async () => {
    await bot().handleUpdate(press(GROUP, 1, "links"));
    const html = tg.sent.at(-1)!.html;
    expect(html).not.toContain(DEMO_TOKEN);
    expect(html).toContain("в личке бота");
    for (const g of ["Продукт", "Админки", "Разработка", "Сервисы", "v2 / превью"]) expect(html).toContain(`<b>${g}</b>`);
    expect(html).toContain("https://kniga.example/admin/families");
    expect(html).toContain("https://vercel.com/prokodan/kniga-semyi/settings/environment-variables");
    expect(html).toContain("Появятся после #211");
  });

  it("в личке Данила — ссылки демо-семьи и киоска", async () => {
    await bot().handleUpdate({ ...press(1, 1, "links"), callback_query: { id: "cb", from: { id: 1 }, data: "links", message: { message_id: 5, chat: { id: 1, type: "private" } } } });
    const html = tg.sent.at(-1)!.html;
    expect(html).toContain(`https://kniga.example/f/${DEMO_TOKEN}/names`);
    expect(html).toContain(`https://kniga.example/extras/${DEMO_TOKEN}/tale`);
    expect(html).toContain("Демо киоска «Ли Нина · пример»");
  });

  it("превью показывается, только когда его /api/health знает env (#211 слит)", async () => {
    gh.preview = { url: "https://kniga-semyi-git-x.vercel.app", ref: "z6/x", sha: "abcdef123", created_at: "2026-11-27T00:00:00Z" };
    await bot().handleUpdate(press(GROUP, 1, "links"));
    expect(tg.sent.at(-1)!.html).not.toContain("kniga-semyi-git-x");
    previewEnv = "preview";
    await bot().handleUpdate(press(GROUP, 1, "links"));
    expect(tg.sent.at(-1)!.html).toContain("https://kniga-semyi-git-x.vercel.app/api/health");
  });
});

describe("сводка: части (#212)", () => {
  const run = (name: string, conclusion: string, at: string): GhRun => ({
    id: 1, name, event: "push", status: "completed", conclusion, html_url: `https://gh/${name}`, created_at: at,
  });

  it("приветствие по часам Алматы", () => {
    expect(greeting(new Date("2026-11-27T04:00:00Z"))).toContain("утро"); // 09:00
    expect(greeting(new Date("2026-11-27T08:00:00Z"))).toContain("день"); // 13:00
    expect(greeting(new Date("2026-11-27T13:38:00Z"))).toContain("вечер"); // 18:38
    expect(greeting(new Date("2026-11-27T19:00:00Z"))).toContain("ночи"); // 00:00
  });

  it("красные — только если последний запуск workflow всё ещё красный", () => {
    const r = redChecks([
      run("ci", "failure", "2026-11-27T01:00:00Z"),
      run("ci", "success", "2026-11-27T02:00:00Z"),
      run("smoke", "failure", "2026-11-27T03:00:00Z"),
      run("e2e", "cancelled", "2026-11-27T03:00:00Z"),
    ]);
    expect(r.red.map((x) => x.name)).toEqual(["smoke"]);
    expect(r.fixed).toEqual(["ci"]);
  });

  it("расход ИИ: прод + staging, когда в ai_usage появится env (#211)", () => {
    const line = aiLine({ ...STATS, ai: { staging: { yesterday: 0.05, today: 0, month: 0.5 }, prod: { yesterday: 0.25, today: 0, month: 8 } } });
    expect(line).toBe("🟠 ИИ: вчера $0.30 (prod $0.25 + staging $0.05) · месяц $8.50 (prod $8.00 + staging $0.50) из $10 (85%)");
  });

  it("пусто — «всё спокойно»; зависшие главы и новые семьи — числом", () => {
    const empty = buildOverview([], [], NOON);
    const calm = buildDigest({ now: NOON, milestones: cfg.milestones, overview: empty, runs: [], stats: STATS, repo: cfg.repo, who: (x) => x });
    expect(calm).toContain("Всё спокойно");
    const busy = buildDigest({
      now: NOON, milestones: cfg.milestones, overview: empty, runs: [], repo: cfg.repo, who: (x) => x,
      stats: { ...STATS, stuck: { count: 2, oldest_min: 40 }, new_families: 3 },
    });
    expect(busy).toContain("Зависли главы > 15 мин: <b>2</b>, самая старая — 40 мин");
    expect(busy).toContain("Новых семей за сутки: <b>3</b>");
    expect(busy).not.toContain("Всё спокойно");
  });

  it("вехи из BOT_MILESTONES: ближайшая будущая, опечатка → значения по умолчанию", () => {
    expect(parseMilestones("2026-12-06T10:00+05:00=Финал;мусор").map((m) => m.title)).toEqual(["Финал"]);
    expect(parseMilestones("мусор").map((m) => m.title)).toEqual(["Видео полуфинала", "Финал Startup-Nunchi"]);
    const after = buildDigest({ now: new Date("2026-11-28T04:00:00Z"), milestones: cfg.milestones, overview: buildOverview([], [], NOON), runs: [], stats: null, repo: cfg.repo, who: (x) => x });
    expect(after).toContain("Финал Startup-Nunchi (06.12 10:00)");
  });
});
