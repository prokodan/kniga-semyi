// Сводка бота (#212) — чистые функции: тексты из уже собранных данных, без сети и базы.
import { nextMilestone, type Milestone } from "./config";
import type { GhRun } from "./github";
import { almatyHour } from "./notify";
import type { Overview } from "./tasks";
import { escapeHtml as e } from "./telegram";

/** Ответ public.bot_digest_stats() (миграция 20261127090000). */
export type DigestStats = {
  ai: Record<string, { yesterday: number; today: number; month: number }>;
  budget: { day: number | null; month: number | null } | null;
  stuck: { count: number; oldest_min: number | null };
  new_families: number;
  env_column?: boolean;
  cron?: { scheduled: boolean; schedule: string | null; last_run: { at: string; status: string } | null };
};

/** Приветствие по фактическому времени Алматы — если сводка опоздала, она не скажет «доброе утро» вечером. */
export function greeting(now: Date): string {
  const h = almatyHour(now);
  if (h >= 5 && h < 12) return "☀️ Доброе утро";
  if (h >= 12 && h < 18) return "🌤 Добрый день";
  if (h >= 18 && h < 23) return "🌆 Добрый вечер";
  return "🌙 Доброй ночи";
}

export function countdown(now: Date, to: Date): string {
  const ms = to.getTime() - now.getTime();
  if (ms <= 0) return "уже прошло";
  const h = Math.floor(ms / 3_600_000);
  const d = Math.floor(h / 24);
  return d > 0 ? `${d} дн ${h % 24} ч` : `${h} ч ${Math.floor((ms % 3_600_000) / 60_000)} мин`;
}

/** «27.11 23:59» по Алматы. */
export function almatyDate(d: Date): string {
  const x = new Date(d.getTime() + 5 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(x.getUTCDate())}.${p(x.getUTCMonth() + 1)} ${p(x.getUTCHours())}:${p(x.getUTCMinutes())}`;
}

export function milestoneLine(list: Milestone[], now: Date): string {
  const m = nextMilestone(list, now);
  if (!m) return "🎯 Все вехи пройдены — дальше v2 (языки и масштаб)";
  return `🎯 ${e(m.title)} (${almatyDate(m.at)}): через <b>${countdown(now, m.at)}</b>`;
}

/** Красные проверки: workflow, у которого последний запуск на main за сутки — failure. Починенные — отдельно. */
export function redChecks(runs: GhRun[]): { red: GhRun[]; fixed: string[] } {
  const latest = new Map<string, GhRun>();
  const failed = new Set<string>();
  const sorted = [...runs]
    .filter((r) => r.status === "completed" && r.conclusion && !["cancelled", "skipped"].includes(r.conclusion))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const r of sorted) {
    latest.set(r.name, r);
    if (r.conclusion === "failure" || r.conclusion === "timed_out") failed.add(r.name);
  }
  const red = [...failed].map((n) => latest.get(n)!).filter((r) => r.conclusion !== "success");
  const fixed = [...failed].filter((n) => latest.get(n)?.conclusion === "success");
  return { red, fixed };
}

const usd = (n: number) => `$${n < 10 ? n.toFixed(2) : n.toFixed(0)}`;

export function aiLine(s: DigestStats): string {
  const envs = Object.entries(s.ai).sort(([a], [b]) => (a === "prod" ? -1 : b === "prod" ? 1 : a.localeCompare(b)));
  const sum = (k: "yesterday" | "month") => envs.reduce((acc, [, v]) => acc + Number(v[k] ?? 0), 0);
  const split = (k: "yesterday" | "month") =>
    envs.length > 1 ? ` (${envs.map(([env, v]) => `${e(env)} ${usd(Number(v[k] ?? 0))}`).join(" + ")})` : "";
  const month = sum("month");
  const budget = s.budget?.month ? Number(s.budget.month) : null;
  // #218: у превью свои ключи и бюджет — бюджет прода сравниваем только с расходом прода
  const prodMonth = envs.length > 1 ? Number(s.ai.prod?.month ?? 0) : month;
  const share = budget ? prodMonth / budget : null;
  const icon = share !== null && share >= 0.8 ? "🟠" : "🤖";
  const of = !budget ? "" : envs.length > 1 ? ` · прод ${Math.round(share! * 100)}% из ${usd(budget)}` : ` из ${usd(budget)} (${Math.round(share! * 100)}%)`;
  return `${icon} ИИ: вчера ${usd(sum("yesterday"))}${split("yesterday")} · месяц ${usd(month)}${split("month")}${of}`;
}

export type DigestInput = {
  now: Date;
  milestones: Milestone[];
  overview: Overview;
  /** null — не удалось прочитать Actions */
  runs: GhRun[] | null;
  stats: DigestStats | null;
  repo: string;
  /** github login → «Данил» / «Влад» */
  who: (login: string) => string;
};

export function buildDigest(d: DigestInput): string {
  const gh = `https://github.com/${d.repo}`;
  const a = (href: string, text: string) => `<a href="${e(href)}">${e(text)}</a>`;
  const lines: string[] = [`<b>${greeting(d.now)}! Сводка «Книги семьи»</b>`, milestoneLine(d.milestones, d.now)];
  const alerts: string[] = [];

  if (d.runs) {
    const { red, fixed } = redChecks(d.runs);
    if (red.length) alerts.push(`🔴 Красные на main: ${red.map((r) => a(r.html_url, r.name)).join(", ")}`);
    if (fixed.length) alerts.push(`🟢 Падали за сутки, уже зелёные: ${fixed.map(e).join(", ")}`);
  } else alerts.push("⚪️ Проверки на main: Actions не ответил");

  const prs = d.overview.openPulls;
  if (prs.length) {
    alerts.push(
      `👀 Открытые PR (${prs.length}): ` +
        prs
          .slice(0, 6)
          .map(({ pull, hours }) => `${a(pull.html_url, `#${pull.number}`)}${hours !== null ? ` ${hours < 48 ? `${hours} ч` : `${Math.floor(hours / 24)} дн`}` : ""}${pull.draft ? " черновик" : ""}`)
          .join(", "),
    );
  }

  const human = d.overview.human;
  if (human.length) {
    alerts.push(
      `🙋 Дела людей (${human.length}): ` +
        human
          .slice(0, 5)
          .map((t) => `${a(t.url, `#${t.number}`)}${t.assignees.length ? ` (${t.assignees.map(d.who).join(", ")})` : ""}`)
          .join(", ") +
        ` · ${a(`${gh}/issues?q=is%3Aopen+label%3Aowner%3Ahuman`, "все")}`,
    );
  }

  if (d.stats) {
    if (d.stats.stuck.count > 0) {
      alerts.push(`⏳ Зависли главы > 15 мин: <b>${d.stats.stuck.count}</b>${d.stats.stuck.oldest_min ? `, самая старая — ${d.stats.stuck.oldest_min} мин` : ""} · Actions → diag`);
    }
    if (d.stats.new_families > 0) alerts.push(`👪 Новых семей за сутки: <b>${d.stats.new_families}</b>`);
  }

  const busy = d.overview.inProgress;
  if (busy.length) {
    alerts.push(`🛠 В работе: ${busy.map((t) => `${a(t.url, `#${t.number}`)}${t.assignees.length ? ` (${t.assignees.map(d.who).join(", ")})` : ""}`).join(", ")}`);
  }

  const calm = alerts.length === 0 || alerts.every((l) => l.startsWith("🟢"));
  lines.push(...(calm ? ["✅ Всё спокойно: проверки зелёные, PR и дел людей нет, главы не висят.", ...alerts] : alerts));
  lines.push(d.stats ? aiLine(d.stats) : "🤖 ИИ: нет данных из базы");
  lines.push(`📋 Открытых задач: ${d.overview.open} · закрыто за неделю: ${d.overview.closedWeek} · пульт — /menu`);
  return lines.join("\n");
}
