// Логика бота: апдейты Telegram и события из GitHub Actions. Все внешние зависимости — через deps,
// поэтому тесты гоняют её без сети.
import type { BotConfig } from "./config";
import { GithubReadOnlyError, type GithubApi } from "./github";
import { BACK, HEALTH, MENU, prefsKeyboard, queueKeyboard, ROLE } from "./keyboards";
import { decide, formatEvent, PREF_LABELS, type NotifyEvent, type Prefs } from "./notify";
import { buildDigest, type DigestStats } from "./digest";
import { buildPrompt, HANDOFF_PATH, roleForOwner, templateFromHandoff } from "./prompts";
import type { BotStore, BotUser, Role } from "./store";
import { buildOverview, buildQueue, buildTasks, findTask, IN_PROGRESS_LABEL, type GhIssue, type Task } from "./tasks";
import { escapeHtml as e, type Keyboard, type TelegramApi, type TgUpdate, type TgUser } from "./telegram";
import {
  ASK_ROLE,
  askLogin,
  healthText,
  HELP_COMMANDS,
  instructionDanil,
  instructionVlad,
  linksText,
  MENU_TEXT,
  progressText,
  queueText,
  READ_ONLY_TAKE,
  whoName,
  type DemoFamily,
  type HealthResult,
  type LinksExtra,
} from "./texts";

export type BotDeps = {
  cfg: BotConfig;
  tg: TelegramApi;
  gh: GithubApi;
  store: BotStore;
  now?: () => Date;
  fetchHealth?: () => Promise<HealthResult | null>;
  /** /api/health любого адреса (превью) — для «Ссылок». */
  fetchUrlHealth?: (url: string) => Promise<HealthResult | null>;
  /** Данные из базы (service-ключ): цифры сводки и демо-семьи. Без базы — null / []. */
  ops?: { stats(): Promise<DigestStats | null>; stagingStats?(): Promise<DigestStats | null | undefined>; demoFamilies(): Promise<DemoFamily[]> };
};

type Ctx = {
  chatId: number;
  messageId?: number;
  callbackId?: string;
  from: TgUser;
  user: BotUser | null;
  /** Личка участника (не группа) — только здесь ссылки с токеном демо. */
  privateChat: boolean;
};

export type NotifyResult = { delivered: boolean; silent?: boolean; reason?: string };

const WORKFLOWS: Record<string, string> = { smoke: "smoke.yml", "ai-models": "ai-models.yml" };

export function createBot(deps: BotDeps) {
  const { cfg, tg, gh, store } = deps;
  const now = deps.now ?? (() => new Date());

  const isGroup = (chatId: number) => cfg.chatId !== undefined && String(chatId) === cfg.chatId;
  const prefsChat = (chatId: number) => cfg.chatId ?? String(chatId);

  async function show(ctx: Ctx, html: string, keyboard?: Keyboard) {
    if (ctx.messageId !== undefined) await tg.edit(ctx.chatId, ctx.messageId, html, { keyboard });
    else await tg.send(ctx.chatId, html, { keyboard });
  }

  async function loadTasks(): Promise<{ tasks: Task[]; issues: GhIssue[] }> {
    const issues = await gh.listIssues();
    return { tasks: buildTasks(issues), issues };
  }

  async function progressView(): Promise<string> {
    const [issues, pulls, users] = await Promise.all([gh.listIssues(), gh.listPulls(), store.listUsers()]);
    return progressText(buildOverview(issues, pulls, now()), users, cfg, now());
  }

  /** Шаблон промпта из docs/HANDOFF.md §7 в main; не прочитался — запасная копия. */
  async function promptTemplate(): Promise<string | undefined> {
    return templateFromHandoff(await gh.readFile(HANDOFF_PATH).catch(() => null)) ?? undefined;
  }

  /** Превью / staging (#211): BOT_STAGING_URL или последнее превью, если его /api/health уже знает env (#211 слит). */
  async function previewLink(): Promise<LinksExtra["preview"]> {
    if (cfg.stagingUrl) return { url: cfg.stagingUrl, note: "staging (BOT_STAGING_URL)" };
    const pv = await gh.latestPreview().catch(() => null);
    if (!pv) return null;
    const h = deps.fetchUrlHealth ? await deps.fetchUrlHealth(pv.url).catch(() => null) : null;
    const env = h?.json?.env;
    if (typeof env !== "string") return null; // до #211 превью смотрит в боевую базу — не показываем
    return { url: pv.url, note: `${env} · ветка ${pv.ref} · ${pv.sha.slice(0, 7)}` };
  }

  async function linksView(ctx: Ctx) {
    const canSeeTokens = ctx.privateChat && Boolean(ctx.user?.role);
    const [demo, preview] = await Promise.all([
      canSeeTokens && deps.ops ? deps.ops.demoFamilies().catch(() => []) : Promise.resolve([]),
      previewLink(),
    ]);
    await show(ctx, linksText(cfg, { privateChat: canSeeTokens, demo, preview }), BACK);
  }

  async function queueView(ctx: Ctx) {
    const { tasks } = await loadTasks();
    const q = buildQueue(tasks);
    await show(ctx, queueText(q), queueKeyboard(q.ready));
  }

  async function prefsView(ctx: Ctx) {
    const p = await store.getPrefs(prefsChat(ctx.chatId));
    await show(ctx, "<b>🔔 Уведомления в группе</b>\nНажмите, чтобы включить или выключить. В тихие часы сообщения приходят без звука.", prefsKeyboard(p));
  }

  async function healthView(ctx: Ctx) {
    const h = deps.fetchHealth ? await deps.fetchHealth() : null;
    await show(ctx, healthText(h), HEALTH);
  }

  async function promptMessage(task: Task, role: Role, all: Task[], body: string | null, header: string): Promise<string> {
    const tpl = await promptTemplate();
    return `${header}\n<pre>${e(buildPrompt(role, task, all, body, cfg.repo, tpl))}</pre>`;
  }

  async function take(ctx: Ctx, ref: string) {
    const user = ctx.user;
    if (!user?.github_login) return tg.send(ctx.chatId, "Сначала привяжите GitHub: <code>/iam ваш_логин</code>");
    if (!gh.canWrite) return tg.send(ctx.chatId, READ_ONLY_TAKE);
    const { tasks, issues } = await loadTasks();
    const task = findTask(tasks, ref);
    if (!task) return tg.send(ctx.chatId, `Не нашёл задачу «${e(ref)}». Пример: <code>/take I5</code>`);
    if (task.state === "closed") return tg.send(ctx.chatId, `${e(task.code ?? `#${task.number}`)} уже закрыта ✅`);
    const login = user.github_login;
    const others = task.assignees.filter((a) => a.toLowerCase() !== login.toLowerCase());
    if (others.length) {
      const users = await store.listUsers();
      return tg.send(ctx.chatId, `${e(task.code ?? "")} уже в работе у ${others.map((o) => whoName(o, users)).join(", ")}.`);
    }
    if (task.openDeps.length) {
      return tg.send(ctx.chatId, `⛓ ${e(task.code ?? "")} пока нельзя брать: не закрыты ${task.openDeps.join(", ")}.`);
    }
    const assigned = await gh.assign(task.number, login);
    if (!assigned.some((a) => a.toLowerCase() === login.toLowerCase())) {
      return tg.send(
        ctx.chatId,
        `GitHub не назначил <code>${e(login)}</code> на #${task.number}. Проверьте, что этот логин — участник репозитория (Settings → Collaborators).`,
      );
    }
    await gh.addLabel(task.number, IN_PROGRESS_LABEL);
    const role = user.role ?? roleForOwner(task.owner);
    const body = issues.find((i) => i.number === task.number)?.body ?? null;
    const header = `✋ <b>${e(user.name)}</b> взял(а) <a href="${e(task.url)}">#${task.number}</a> ${e(task.name)}\nПромпт для нового чата Claude — нажмите, чтобы скопировать:`;
    await tg.send(ctx.chatId, await promptMessage(task, role, tasks, body, header));
  }

  async function release(ctx: Ctx, ref: string) {
    const user = ctx.user;
    if (!user?.github_login) return tg.send(ctx.chatId, "Сначала привяжите GitHub: <code>/iam ваш_логин</code>");
    if (!gh.canWrite) return tg.send(ctx.chatId, READ_ONLY_TAKE);
    const { tasks } = await loadTasks();
    const task = findTask(tasks, ref);
    if (!task) return tg.send(ctx.chatId, `Не нашёл задачу «${e(ref)}».`);
    await gh.unassign(task.number, user.github_login);
    const rest = task.assignees.filter((a) => a.toLowerCase() !== user.github_login!.toLowerCase());
    if (rest.length === 0) await gh.removeLabel(task.number, IN_PROGRESS_LABEL);
    await tg.send(ctx.chatId, `↩️ ${e(task.code ?? `#${task.number}`)} вернулась в очередь.`);
  }

  async function prompt(ctx: Ctx, ref: string) {
    const { tasks, issues } = await loadTasks();
    const task = findTask(tasks, ref);
    if (!task) return tg.send(ctx.chatId, `Не нашёл задачу «${e(ref)}». Пример: <code>/prompt I5</code>`);
    const role = ctx.user?.role ?? roleForOwner(task.owner);
    const body = issues.find((i) => i.number === task.number)?.body ?? null;
    await tg.send(ctx.chatId, await promptMessage(task, role, tasks, body, `📝 Промпт #${task.number} для нового чата Claude:`));
  }

  async function iam(ctx: Ctx, login: string) {
    const clean = login.trim().replace(/^@/, "");
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(clean)) {
      return tg.send(ctx.chatId, "Пришлите логин GitHub так: <code>/iam prokodan</code>");
    }
    if (!ctx.user?.role) {
      await store.upsertUser({ tg_id: ctx.from.id, name: displayName(ctx.from), github_login: clean, role: null });
      return tg.send(ctx.chatId, `Логин <code>${e(clean)}</code> сохранён. ${ASK_ROLE}`, { keyboard: ROLE });
    }
    await store.upsertUser({ ...ctx.user, github_login: clean });
    await tg.send(ctx.chatId, `Готово: вы — ${ctx.user.role === "danil" ? "Данил" : "Влад"}, GitHub <code>${e(clean)}</code>. Откройте /menu.`);
  }

  async function onCommand(ctx: Ctx, text: string) {
    const [rawCmd, ...args] = text.trim().split(/\s+/);
    const cmd = rawCmd!.replace(/@.*$/, "").toLowerCase();
    const arg = args.join(" ");
    if (cmd === "/iam") return arg ? iam(ctx, arg) : tg.send(ctx.chatId, "Пришлите логин GitHub так: <code>/iam prokodan</code>");
    if (!ctx.user?.role) return tg.send(ctx.chatId, ASK_ROLE, { keyboard: ROLE });
    switch (cmd) {
      case "/start":
      case "/menu":
        return tg.send(ctx.chatId, MENU_TEXT, { keyboard: MENU });
      case "/help":
        return tg.send(ctx.chatId, HELP_COMMANDS);
      case "/take":
        return arg ? take(ctx, arg) : tg.send(ctx.chatId, "Какую задачу взять? <code>/take I5</code>");
      case "/release":
        return arg ? release(ctx, arg) : tg.send(ctx.chatId, "Какую задачу вернуть? <code>/release I5</code>");
      case "/prompt":
        return arg ? prompt(ctx, arg) : tg.send(ctx.chatId, "Для какой задачи промпт? <code>/prompt I5</code>");
      default:
        return; // чужие команды в группе не комментируем
    }
  }

  async function onCallback(ctx: Ctx, data: string) {
    const [kind, arg = ""] = data.split(":");
    if (kind === "role" && (arg === "danil" || arg === "vlad")) {
      const user: BotUser = { tg_id: ctx.from.id, name: displayName(ctx.from), github_login: ctx.user?.github_login ?? null, role: arg };
      await store.upsertUser(user);
      await tg.answer(ctx.callbackId!, "Запомнил");
      return user.github_login
        ? tg.send(ctx.chatId, `Готово: вы — ${arg === "danil" ? "Данил" : "Влад"}, GitHub <code>${e(user.github_login)}</code>. Откройте /menu.`)
        : tg.send(ctx.chatId, askLogin(arg));
    }
    if (!ctx.user?.role) {
      await tg.answer(ctx.callbackId!);
      return tg.send(ctx.chatId, ASK_ROLE, { keyboard: ROLE });
    }
    await tg.answer(ctx.callbackId!);
    switch (kind) {
      case "menu":
        return show(ctx, MENU_TEXT, MENU);
      case "progress":
        return show(ctx, await progressView(), [[{ text: "🔄 Обновить", callback_data: "progress" }], ...BACK]);
      case "queue":
        return queueView(ctx);
      case "links":
        return linksView(ctx);
      case "health":
        return healthView(ctx);
      case "help":
        return show(ctx, arg === "vlad" ? instructionVlad(cfg.repo) : instructionDanil(cfg.repo), BACK);
      case "prefs":
        return prefsView(ctx);
      case "pref": {
        const chat = prefsChat(ctx.chatId);
        const p = await store.getPrefs(chat);
        if (!(arg in PREF_LABELS)) return;
        const next: Prefs = { ...p, [arg]: !p[arg as keyof Prefs] };
        await store.savePrefs(chat, next);
        return prefsView(ctx);
      }
      case "take":
        return take({ ...ctx, messageId: undefined }, `#${arg}`);
      case "prompt":
        return prompt({ ...ctx, messageId: undefined }, `#${arg}`);
      case "run": {
        const wf = WORKFLOWS[arg];
        if (!wf) return;
        if (!gh.canWrite) return tg.send(ctx.chatId, READ_ONLY_TAKE.replace("«Взять» назначал задачи", "кнопки запускали workflow"));
        await gh.dispatch(wf);
        return tg.send(ctx.chatId, `▶️ Запустил ${e(arg)} — результат придёт уведомлением.\n<a href="https://github.com/${e(cfg.repo)}/actions/workflows/${e(wf)}">Открыть в Actions</a>`);
      }
      default:
        return;
    }
  }

  async function handleUpdate(update: TgUpdate): Promise<void> {
    const msg = update.message;
    const cb = update.callback_query;
    const chat = msg?.chat ?? cb?.message?.chat;
    const from = msg?.from ?? cb?.from;
    if (!chat || !from) return;

    const user = await store.getUser(from.id);
    // Доступ: группа команды целиком или личка участника из bot_users. Остальным — тишина.
    const allowed = isGroup(chat.id) || (chat.type === "private" && user !== null);
    if (!allowed) return;

    const ctx: Ctx = {
      chatId: chat.id,
      from,
      user,
      messageId: cb?.message?.message_id,
      callbackId: cb?.id,
      privateChat: chat.type === "private" && !isGroup(chat.id),
    };
    try {
      if (cb?.data) await onCallback(ctx, cb.data);
      else if (msg?.text?.startsWith("/")) await onCommand(ctx, msg.text);
    } catch (err) {
      const text =
        err instanceof GithubReadOnlyError ? READ_ONLY_TAKE : `⚠️ Не получилось: ${e(err instanceof Error ? err.message : String(err))}`;
      console.error("[bot]", err instanceof Error ? err.message : "error");
      await tg.send(chat.id, text).catch(() => {});
    }
  }

  async function digestText(): Promise<string> {
    const n = now();
    const since = new Date(n.getTime() - 86_400_000).toISOString();
    const [issues, pulls, users, runs, stats, staging] = await Promise.all([
      gh.listIssues(),
      gh.listPulls(),
      store.listUsers(),
      gh.listMainRuns(since).catch(() => null),
      deps.ops ? deps.ops.stats().catch(() => null) : Promise.resolve(null),
      deps.ops?.stagingStats ? deps.ops.stagingStats().catch(() => null) : Promise.resolve(undefined),
    ]);
    return buildDigest({
      now: n,
      milestones: cfg.milestones,
      overview: buildOverview(issues, pulls, n),
      runs,
      stats,
      staging,
      repo: cfg.repo,
      who: (login) => whoName(login, users),
    });
  }

  async function handleNotify(ev: NotifyEvent): Promise<NotifyResult> {
    if (!cfg.chatId) return { delivered: false, reason: "TELEGRAM_CHAT_ID не задан" };
    const prefs = await store.getPrefs(cfg.chatId);
    const d = decide(ev.event, prefs, now());
    if (!d.deliver) return { delivered: false, reason: d.reason };
    const html = ev.event === "digest" ? await digestText() : formatEvent(ev);
    await tg.send(cfg.chatId, html, { silent: d.silent, keyboard: ev.event === "digest" ? MENU : undefined });
    return { delivered: true, silent: d.silent };
  }

  return { handleUpdate, handleNotify, digestText };
}

function displayName(u: TgUser): string {
  return [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || `id${u.id}`;
}
