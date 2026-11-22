// Тексты бота (HTML-разметка Telegram). Всё, что пришло извне, экранируется.
import type { BotConfig } from "./config";
import type { Progress, Queue, Task } from "./tasks";
import { progressBar } from "./tasks";
import { escapeHtml as e } from "./telegram";
import type { BotUser } from "./store";

const ROLE_NAME = { danil: "Данил", vlad: "Влад" } as const;

export function countdown(now: Date, to: Date): string {
  const ms = to.getTime() - now.getTime();
  if (ms <= 0) return "уже прошло";
  const h = Math.floor(ms / 3_600_000);
  const d = Math.floor(h / 24);
  return d > 0 ? `${d} дн ${h % 24} ч` : `${h} ч ${Math.floor((ms % 3_600_000) / 60_000)} мин`;
}

function code(t: Task): string {
  return t.code ?? `#${t.number}`;
}

function link(t: Task): string {
  return `<a href="${e(t.url)}">${e(code(t))}</a>`;
}

export function whoName(login: string | null | undefined, users: BotUser[]): string {
  if (!login) return "—";
  const u = users.find((x) => x.github_login?.toLowerCase() === login.toLowerCase());
  return e(u?.role ? ROLE_NAME[u.role] : u?.name ?? login);
}

export function progressText(p: Progress, users: BotUser[], cfg: BotConfig, now: Date): string {
  const lines = [
    `<b>📊 Прогресс · ${e(cfg.milestone)}</b>`,
    `<code>${progressBar(p.done.length, p.total)}</code>`,
    `⏳ До заморозки (ср 25.11 14:00): <b>${countdown(now, cfg.freezeAt)}</b>`,
    `🎤 До питча (пт 27.11): <b>${countdown(now, cfg.pitchAt)}</b>`,
    "",
    `<b>✅ Готово (${p.done.length})</b>`,
    ...p.done.map(({ task, who }) => `• ${link(task)} ${e(task.name)} — ${whoName(who, users)}`),
    "",
    `<b>🛠 В работе (${p.inProgress.length + p.openPulls.length})</b>`,
    ...p.inProgress.map(({ task, who }) => `• ${link(task)} ${e(task.name)} — ${who.map((w) => whoName(w, users)).join(", ") || "метка in-progress"}`),
    ...p.openPulls.map((pr) => `• PR <a href="${e(pr.html_url)}">#${pr.number}</a>${pr.draft ? " (черновик)" : ""} ${e(pr.title)}`),
    "",
    `<b>📋 Осталось (${p.left.length})</b>`,
    ...p.left.map((t) => `• ${link(t)} ${e(t.name)}${t.openDeps.length ? ` ⛓ ждёт ${t.openDeps.join(", ")}` : ""}`),
  ];
  return lines.join("\n");
}

export function queueText(q: Queue): string {
  if (q.ready.length === 0) {
    return [
      "<b>🧭 Очередь пуста</b>",
      "Свободных задач без незакрытых зависимостей нет.",
      q.blocked.length ? `Ждут зависимостей: ${q.blocked.map((t) => `${e(code(t))} ← ${t.openDeps.join(", ")}`).join("; ")}` : "",
    ].join("\n");
  }
  const lines = ["<b>🧭 Очередь — можно брать</b>", "Внутри группы задачи из разных зон и не зависят друг от друга — их можно делать параллельно.", ""];
  q.groups.forEach((g, i) => {
    lines.push(`<b>Группа ${i + 1}</b>`);
    for (const t of g) lines.push(`• ${link(t)} ${e(t.zone ?? "—")} ${e(t.name)}${t.owner ? ` · ${e(t.owner)}` : ""}`);
    lines.push("");
  });
  if (q.blocked.length) {
    lines.push(`⛓ Ждут зависимостей: ${q.blocked.map((t) => `${e(code(t))} ← ${t.openDeps.join(", ")}`).join("; ")}`);
  }
  return lines.join("\n").trim();
}

export function linksText(cfg: BotConfig): string {
  const gh = `https://github.com/${cfg.repo}`;
  const ref = /^https:\/\/([a-z0-9]+)\.supabase\.co/i.exec(cfg.supabaseUrl ?? "")?.[1];
  const supa = ref ? `https://supabase.com/dashboard/project/${ref}` : "https://supabase.com/dashboard";
  const a = (href: string, text: string) => `<a href="${e(href)}">${e(text)}</a>`;
  return [
    "<b>🔗 Ссылки</b>",
    cfg.prodUrl ? `• ${a(cfg.prodUrl, "Прод")}` : "• Прод — PROD_URL не задан",
    cfg.prodUrl ? `• ${a(`${cfg.prodUrl}/admin/ai`, "Админка ИИ /admin/ai")}` : null,
    cfg.prodUrl ? `• ${a(`${cfg.prodUrl}/center`, "Кабинет АКНЦ /center")} (когда появится, I9)` : null,
    `• ${a(cfg.vercelUrl, "Vercel")}`,
    `• ${a(supa, "Supabase")}`,
    `• ${a(`${gh}/actions`, "GitHub Actions")}`,
    `• ${a(`${gh}/milestones`, `Milestone «${cfg.milestone}»`)}`,
    `• ${a(`${gh}/issues`, "Issues")} · ${a(`${gh}/tree/main/docs/issues`, "папка задач")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export type HealthResult = { ok: boolean; http: number | null; json: Record<string, unknown> | null; error?: string };

export function healthText(h: HealthResult | null): string {
  if (!h) return "<b>🩺 Здоровье</b>\nPROD_URL не задан — проверять нечего.";
  if (h.http === null) return `<b>🩺 Здоровье</b>\n🔴 Прод не ответил: ${e(h.error ?? "нет ответа")}`;
  const j = h.json ?? {};
  const v = (k: string) => e(String(j[k] ?? "—"));
  return [
    "<b>🩺 Здоровье прода</b>",
    `${h.ok ? "🟢" : "🔴"} HTTP ${h.http} · status <b>${v("status")}</b>`,
    `База: <b>${v("db")}</b>${j.db_error ? ` (${v("db_error")})` : ""}`,
    `ИИ: ${v("ai_mode")} · коммит ${v("commit")} · ${v("region")} · ${v("latency_ms")} мс`,
  ].join("\n");
}

export const MENU_TEXT = "<b>Книга семьи · пульт</b>\nЧто показать?";

export const READ_ONLY_TAKE =
  "🔒 Бот сейчас в режиме «только чтение»: не задан GITHUB_TOKEN.\n" +
  "Чтобы «Взять» назначал задачи, Данилу нужно добавить в Vercel Env секрет <code>GITHUB_TOKEN</code> " +
  "(fine-grained PAT только на kniga-semyi: Issues RW, Actions RW, Pull requests R, Contents R) и сделать Redeploy.\n" +
  "А пока промпт можно получить командой /prompt.";

export const ASK_ROLE = "Здравствуйте! Кто вы — Данил или Влад?";

export function askLogin(role: "danil" | "vlad"): string {
  return `Приятно познакомиться, ${ROLE_NAME[role]}! Теперь привяжите GitHub: <code>/iam ваш_логин</code>`;
}

export const HELP_COMMANDS =
  "/menu — пульт кнопками\n/take I5 — взять задачу\n/release I5 — вернуть в очередь\n/prompt I5 — промпт для агента\n/iam login — привязать GitHub";

export function instructionDanil(repo: string): string {
  return [
    "<b>📘 Инструкция Данилу — задача в новом чате Claude</b>",
    "1. 🧭 Очередь → «Взять» (или <code>/take I5</code>) — задача назначится на вас, придёт готовый промпт.",
    "2. Откройте <b>новый чат Claude вне проекта</b>, включите Code, подключите репозиторий " + e(repo) + ".",
    "3. Вставьте промпт целиком. Агент сам прочитает AGENTS.md и issue, сделает ветку zN/… и PR.",
    "4. <b>Лимиты кончаются?</b> Попросите агента: «запушь, что есть, открой черновик PR и опиши, что осталось». Продолжите в новом чате: «продолжи PR #N».",
    "5. Параллельно — не больше 3 агентов, и только задачи из одной группы очереди.",
    "6. <b>Сливаете только вы</b>: после зелёного CI и проверки превью Vercel. Squash merge.",
  ].join("\n");
}

export function instructionVlad(repo: string): string {
  return [
    "<b>📗 Инструкция Владу — Codex</b>",
    "<b>Разовая настройка</b>",
    "1. Примите инвайт в репозиторий " + e(repo) + " (письмо от GitHub).",
    "2. chatgpt.com/codex → Connect to GitHub → выберите репозиторий.",
    "3. Environment: setup-скрипт <code>npm ci</code>, переменная <code>AI_MODE=mock</code>. Ключи не нужны.",
    "4. Здесь в боте: <code>/iam ваш_github_логин</code>.",
    "",
    "<b>Как брать задачу</b>",
    "1. 🧭 Очередь → «Взять» — придёт промпт для Codex.",
    "2. Вставьте его в Codex → Code. Дождитесь зелёного <code>npm run check</code>.",
    "3. <b>Create PR</b> (не в main!). Номер PR напишите Данилу в группу — сливает он.",
  ].join("\n");
}
