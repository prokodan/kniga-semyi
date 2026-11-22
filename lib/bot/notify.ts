// События из GitHub Actions и фильтр по настройкам чата.
import { z } from "zod";
import { escapeHtml } from "./telegram";

export const EVENTS = ["ci_failed", "pr_opened", "pr_merged", "deploy", "smoke", "ai_models", "digest"] as const;
export type NotifyEventName = (typeof EVENTS)[number];

export type Prefs = Record<NotifyEventName | "quiet_hours", boolean>;

export const DEFAULT_PREFS: Prefs = {
  ci_failed: true,
  pr_opened: true,
  pr_merged: true,
  deploy: true,
  smoke: true,
  ai_models: true,
  digest: true,
  quiet_hours: true,
};

export const PREF_LABELS: Record<keyof Prefs, string> = {
  ci_failed: "CI упал",
  pr_opened: "PR открыт",
  pr_merged: "PR слит",
  deploy: "Деплой прода",
  smoke: "Smoke",
  ai_models: "ai-models",
  digest: "Утренняя сводка 09:00",
  quiet_hours: "Тихие часы 23:00–08:00",
};

export const notifySchema = z.object({
  event: z.enum(EVENTS),
  status: z.enum(["ok", "failed"]).optional(),
  text: z.string().max(3000).optional(),
  url: z.string().url().max(500).optional(),
});
export type NotifyEvent = z.infer<typeof notifySchema>;

/** Алматы — UTC+5 круглый год. */
export function almatyHour(now: Date): number {
  return (now.getUTCHours() + 5) % 24;
}

export function isQuietTime(now: Date): boolean {
  const h = almatyHour(now);
  return h >= 23 || h < 8;
}

export type Decision = { deliver: false; reason: string } | { deliver: true; silent: boolean };

/**
 * Выключенное событие не отправляется совсем. В тихие часы сообщение приходит без звука
 * (Telegram disable_notification) — чтобы утром было видно, что упало ночью.
 */
export function decide(event: NotifyEventName, prefs: Prefs, now: Date): Decision {
  if (!prefs[event]) return { deliver: false, reason: `уведомление «${PREF_LABELS[event]}» выключено` };
  return { deliver: true, silent: prefs.quiet_hours && isQuietTime(now) };
}

const ICON: Record<NotifyEventName, string> = {
  ci_failed: "🔴",
  pr_opened: "👀",
  pr_merged: "✅",
  deploy: "🚀",
  smoke: "🩺",
  ai_models: "🤖",
  digest: "☀️",
};

/** Текст из workflow — обычный, экранируем; ссылку даём отдельной строкой. */
export function formatEvent(e: NotifyEvent): string {
  const icon = e.status === "failed" ? "🔴" : e.event === "smoke" && e.status === "ok" ? "🟢" : ICON[e.event];
  const text = e.text ? escapeHtml(e.text) : PREF_LABELS[e.event];
  const startsWithIcon = /^\p{Extended_Pictographic}/u.test(e.text ?? "");
  return `${startsWithIcon ? "" : `${icon} `}${text}${e.url && !(e.text ?? "").includes(e.url) ? `\n${escapeHtml(e.url)}` : ""}`;
}
