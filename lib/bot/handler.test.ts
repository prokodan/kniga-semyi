import { beforeEach, describe, expect, it } from "vitest";
import type { BotConfig } from "./config";
import { createGithub, type GithubApi } from "./github";
import { createBot } from "./handler";
import { DEFAULT_PREFS, decide, isQuietTime } from "./notify";
import { MemoryBotStore } from "./store";
import type { GhIssue, GhPull } from "./tasks";
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
  vercelUrl: "https://vercel.com/dashboard",
  milestone: "MLP 27.11",
  freezeAt: new Date("2026-11-25T14:00:00+05:00"),
  pitchAt: new Date("2026-11-27T10:00:00+05:00"),
};

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
  { number: 12, title: "[I7] Демо-оплата", body: body("W0", "Z4"), state: "open", html_url: "u12", labels: [{ name: "owner:codex" }], assignees: [], milestone: { number: 1, title: "MLP 27.11" } },
  { number: 11, title: "[I6] Черновик", body: body("I5", "Z3"), state: "open", html_url: "u11", labels: [], assignees: [], milestone: { number: 1, title: "MLP 27.11" } },
  { number: 3, title: "[I2] Конвейер", body: body("—", "Z2"), state: "closed", html_url: "u3", labels: [], assignees: [], milestone: { number: 1, title: "MLP 27.11" } },
];

class FakeGh implements GithubApi {
  repo = cfg.repo;
  issues = structuredClone(ISSUES);
  calls: string[] = [];
  constructor(public canWrite = true) {}
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

function bot(over: Partial<{ gh: GithubApi; now: Date }> = {}) {
  return createBot({ cfg, tg, gh: over.gh ?? gh, store, now: () => over.now ?? NOON });
}

beforeEach(async () => {
  tg = new FakeTg();
  gh = new FakeGh();
  store = new MemoryBotStore();
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
    expect(last).toContain("Codex");
    expect(last).toContain("Create PR");
    expect(last).toContain("Closes #12");
    expect(last).toContain("PRICES_KZT"); // доп. данные I7
  });

  it("Данилу — шаблон Claude, с задачами в работе у других", async () => {
    await bot().handleUpdate(press(GROUP, 2, "take:12"));
    await bot().handleUpdate(msg(GROUP, 1, "/take I5"));
    const last = tg.sent.at(-1)!.html;
    expect(last).toContain("Сделай задачу I5");
    expect(last).toContain("Итог простыми словами");
    expect(last).toContain("Параллельно другие агенты делают I7");
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
    expect(tg.sent.at(-1)!.html).toContain("Сделай задачу I7");
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

  it("утренняя сводка собирается ботом", async () => {
    const r = await bot().handleNotify({ event: "digest" });
    expect(r.delivered).toBe(true);
    expect(tg.sent[0]!.html).toContain("Доброе утро");
    expect(tg.sent[0]!.html).toContain("1/4");
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
