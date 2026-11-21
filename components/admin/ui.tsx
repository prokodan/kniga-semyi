// Базовые куски админки: секция, полоса заполнения, бейдж, форматирование. Только токены из globals.css.
import type { ReactNode } from "react";

export function Section({ id, title, hint, children }: { id?: string; title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-4 rounded-card bg-paper-deep p-4 shadow-card sm:p-5">
      <h2 className="font-serif text-xl">{title}</h2>
      {hint ? <p className="mt-1 text-sm text-muted">{hint}</p> : null}
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  );
}

export function Card({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-4 rounded-card border border-line bg-paper p-3 sm:p-4">
      {children}
    </div>
  );
}

type Tone = "ok" | "near" | "over" | "off" | "info";

const toneBg: Record<Tone, string> = {
  ok: "bg-success",
  near: "bg-warning",
  over: "bg-danger",
  off: "bg-muted",
  info: "bg-jade",
};
const toneText: Record<Tone, string> = {
  ok: "text-success",
  near: "text-warning",
  over: "text-danger",
  off: "text-muted",
  info: "text-jade",
};

export function toneOfPct(pct: number | null, cap = 1): Tone {
  if (pct === null) return "info";
  if (pct >= cap) return "over";
  if (pct >= cap * 0.8) return "near";
  return "ok";
}

/** Полоса заполнения; mark — отметка порога (0..1). */
export function Bar({ value, tone, mark, label }: { value: number; tone: Tone; mark?: number; label: string }) {
  const w = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="relative h-3 w-full overflow-hidden rounded-button bg-line" role="meter" aria-label={label} aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-button ${toneBg[tone]}`} style={{ width: `${w}%` }} />
      {mark !== undefined ? (
        <div className="absolute top-0 h-full w-0.5 bg-ink" style={{ left: `${Math.min(1, mark) * 100}%` }} aria-hidden />
      ) : null}
    </div>
  );
}

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-button border border-line bg-paper px-2 py-0.5 text-xs font-medium ${toneText[tone]}`}>
      <span className={`inline-block size-2 rounded-full ${toneBg[tone]}`} aria-hidden />
      {children}
    </span>
  );
}

export function Notice({ tone, children }: { tone: "ok" | "err" | "info"; children: ReactNode }) {
  const cls =
    tone === "ok" ? "border-success text-success" : tone === "err" ? "border-danger text-danger" : "border-line text-ink-soft";
  return <div className={`rounded-card border bg-paper px-4 py-3 text-sm ${cls}`} role={tone === "err" ? "alert" : "status"}>{children}</div>;
}

export function fmtUsd(v: number): string {
  if (v === 0) return "$0";
  if (Math.abs(v) < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

export function fmtPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** Время по Алматы — так удобнее команде. */
export function fmtTime(iso: string, withDate = true): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Almaty",
    ...(withDate ? { day: "2-digit", month: "2-digit" } : {}),
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function fmtIn(fromIso: string, toIso: string): string {
  const min = Math.max(0, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60_000));
  if (min < 60) return `${min} мин`;
  return `${Math.floor(min / 60)} ч ${min % 60} мин`;
}

export const inputCls =
  "min-h-12 w-full rounded-card border border-line bg-paper px-3 text-base text-ink focus:border-seal focus:outline-none";
export const btnCls =
  "min-h-12 rounded-button bg-seal px-5 text-base font-medium text-paper active:bg-seal-dark disabled:opacity-50";
export const btnGhostCls =
  "min-h-12 rounded-button border border-line bg-paper px-4 text-base text-ink active:bg-paper-deep";
