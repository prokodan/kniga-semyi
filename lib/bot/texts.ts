// Тексты бота (HTML-разметка Telegram). Всё, что пришло извне, экранируется.
import type { BotConfig } from "./config";
import { milestoneLine } from "./digest";
import type { Overview, Queue, Task } from "./tasks";
import { escapeHtml as e } from "./telegram";
import type { BotUser } from "./store";

const ROLE_NAME = { danil: "Данил", vlad: "Влад" } as const;

export { countdown } from "./digest";

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

/** «📊 Прогресс» по открытым issues (#212): что в работе, дела людей, зоны, PR. */
export function progressText(o: Overview, users: BotUser[], cfg: BotConfig, now: Date): string {
  const gh = `https://github.com/${cfg.repo}`;
  const lines = [
    "<b>📊 Прогресс · открытые задачи</b>",
    milestoneLine(cfg.milestones, now),
    `Открыто: <b>${o.open}</b> (без срока, «после питча» / v2: ${o.later}) · закрыто за неделю: <b>${o.closedWeek}</b>`,
    o.byZone.length ? `По зонам: ${o.byZone.map((z) => `${e(z.zone)} ${z.count}`).join(" · ")}` : "",
    "",
    `<b>🛠 В работе (${o.inProgress.length})</b>`,
    ...o.inProgress.map((t) => `• ${link(t)} ${e(t.name)} — ${t.assignees.map((w) => whoName(w, users)).join(", ") || "метка in-progress"}`),
    ...o.openPulls.map(({ pull, hours }) => `• PR <a href="${e(pull.html_url)}">#${pull.number}</a>${pull.draft ? " (черновик)" : ""} ${e(pull.title)}${hours !== null ? ` · ${hours} ч` : ""}`),
    "",
    `<b>🙋 Дела людей — owner:human (${o.human.length})</b>`,
    ...o.human.slice(0, 10).map((t) => `• ${link(t)} ${e(t.name)}`),
    `<a href="${e(`${gh}/issues?q=is%3Aopen+label%3Aowner%3Ahuman`)}">все дела людей</a> · <a href="${e(`${gh}/issues`)}">все issues</a>`,
  ];
  return lines.filter((l, i, arr) => l !== "" || arr[i - 1] !== "").join("\n");
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

export type DemoFamily = { name: string; token: string; source: string };

export type LinksExtra = {
  /** Личка участника с ролью — можно показать ссылки с токеном демо. */
  privateChat: boolean;
  demo: DemoFamily[];
  /** Адрес staging / превью, если включено (#211), и откуда он. */
  preview: { url: string; note: string } | null;
};

function supabaseDashboard(url: string | undefined): string | null {
  const ref = /^https:\/\/([a-z0-9]+)\.supabase\.co/i.exec(url ?? "")?.[1];
  return ref ? `https://supabase.com/dashboard/project/${ref}` : null;
}

/** «🔗 Ссылки» группами (#212). Токены демо-семей — только в личке Данила / Влада. */
export function linksText(cfg: BotConfig, x: LinksExtra = { privateChat: false, demo: [], preview: null }): string {
  const gh = `https://github.com/${cfg.repo}`;
  const blob = (f: string) => `${gh}/blob/main/${f}`;
  const a = (href: string, text: string) => `<a href="${e(href)}">${e(text)}</a>`;
  const p = cfg.prodUrl;
  const at = (path: string, text = path) => (p ? a(`${p}${path}`, text) : e(text));
  const isProject = /^https:\/\/vercel\.com\/[^/]+\/[^/]+$/.test(cfg.vercelUrl);
  const supaProd = supabaseDashboard(cfg.supabaseUrl) ?? "https://supabase.com/dashboard/projects";
  const supaStaging = supabaseDashboard(cfg.stagingSupabaseUrl);

  const demo: string[] = [];
  if (x.privateChat) {
    for (const f of x.demo) {
      const t = encodeURIComponent(f.token);
      demo.push(
        f.source === "kiosk"
          ? `• Демо киоска «${e(f.name)}»: ${at(`/f/${t}`, "семья")} · ${at(`/book/${t}`, "книга")}`
          : `• Демо «${e(f.name)}»: ${at(`/f/${t}`, "семья")} · ${at(`/book/${t}`, "книга")} · ${at(`/f/${t}/names`, "словарь имён")} · ${at(`/extras/${t}/tale`, "сказка")}`,
      );
    }
    if (!x.demo.length) demo.push("• Демо-семьи не найдены — Actions → seed-demo");
  } else {
    demo.push("• 🔒 Ссылки демо-семей (с токеном) — в личке бота: /menu → 🔗 Ссылки");
  }

  return [
    "<b>🔗 Ссылки</b>",
    "",
    "<b>Продукт</b>",
    p ? `• ${a(p, "Прод")} · ${at("/start", "создать семью /start")}` : "• Прод — PROD_URL не задан",
    ...demo,
    "",
    "<b>Админки</b> (PIN)",
    `• ${at("/admin")} · ${at("/admin/ai")} · ${at("/admin/families")}`,
    `• АКНЦ: ${at("/center")} · ${at("/center/archive")}`,
    `• Киоск: ${at("/kiosk")} · ${at("/kiosk/archive")} · ${at("/kiosk/archive/show", "показ")}`,
    `• ${at("/api/health")}`,
    "",
    "<b>Разработка</b>",
    `• ${a(gh, "Репозиторий")} · ${a(`${gh}/issues`, "Issues")} · ${a(`${gh}/issues?q=is%3Aopen+label%3Aowner%3Ahuman`, "owner:human")} · ${a(`${gh}/pulls`, "PR")}`,
    `• Actions: ${a(`${gh}/actions`, "все")} · ${["smoke", "migrate", "seed-demo", "diag"].map((w) => a(`${gh}/actions/workflows/${w}.yml`, w)).join(" · ")}`,
    `• ${a(blob("docs/HANDOFF.md"), "HANDOFF")} · ${a(blob("docs/STATUS.md"), "STATUS")} · ${a(blob("docs/DECISIONS.md"), "DECISIONS")}`,
    "",
    "<b>Сервисы</b>",
    `• Supabase: ${a(supaProd, "прод")} · ${supaStaging ? a(supaStaging, "staging") : "staging — после #211"}`,
    `• Vercel: ${a(cfg.vercelUrl, isProject ? "проект" : "дашборд")}${isProject ? ` · ${a(`${cfg.vercelUrl}/settings/environment-variables`, "Environment Variables")}` : ""}`,
    `• ИИ: ${a("https://aistudio.google.com/usage", "Google AI Studio — расход")} · ${a("https://platform.openai.com/usage", "OpenAI Usage")}`,
    "",
    "<b>v2 / превью</b>",
    x.preview
      ? `• ${a(x.preview.url, "Последнее превью")} · ${a(`${x.preview.url}/api/health`, "/api/health")} — ${e(x.preview.note)}`
      : "• Появятся после #211 (staging): превью пока пишут в боевую базу",
  ].join("\n");
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
  "/menu — пульт кнопками\n/take 212 — взять задачу (номер issue)\n/release 212 — вернуть в очередь\n/prompt 212 — промпт для нового чата\n/iam login — привязать GitHub";

/** Инструкции — коротко, со ссылкой на HANDOFF (там всё подробно и всегда актуально). */
export function instructionDanil(repo: string): string {
  const gh = `https://github.com/${repo}`;
  return [
    "<b>📘 Данилу — задача в новом чате Claude</b>",
    "1. 🧭 Очередь → «Взять» (или <code>/take 212</code>) — задача назначится на вас, придёт промпт по HANDOFF §7.",
    "2. Новый чат Claude <b>вне проектов</b>, один чат = одна задача. Вставьте промпт целиком.",
    "3. Агент сам: ветка → PR с «📝 Заметками для команды» → зелёные ci и e2e → squash-слияние → migrate / smoke.",
    "4. Каждое «руками» агент заводит отдельной issue с меткой owner:human — смотрите 📊 Прогресс.",
    "5. «Лимиты кончаются» — агент открывает черновой PR «Сделано / Осталось / Как продолжить».",
    `Подробно: <a href="${e(`${gh}/blob/main/docs/HANDOFF.md`)}">docs/HANDOFF.md</a> (§3 — правила, §7 — промпт).`,
  ].join("\n");
}

export function instructionVlad(repo: string): string {
  const gh = `https://github.com/${repo}`;
  return [
    "<b>📗 Владу — задача в новом чате Claude</b>",
    "1. 🧭 Очередь → «Взять» — придёт тот же универсальный промпт (HANDOFF §7), с «Я — Влад».",
    "2. Первый раз Claude попросит подключить GitHub — подключите свой аккаунт (вы коллаборатор). Не даётся — напишите Данилу.",
    "3. Новый чат вне проектов, один чат = одна задача; агент сам доводит PR до main, если ci и e2e зелёные.",
    "4. Правите <code>prompts/</code> — ждите комментарий eval: 🔴 по фактам = не сливать.",
    `Подробно: <a href="${e(`${gh}/blob/main/docs/HANDOFF.md`)}">docs/HANDOFF.md</a>.`,
  ].join("\n");
}
