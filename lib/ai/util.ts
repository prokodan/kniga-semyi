import { createHash } from "node:crypto";
import { priceOf } from "./config";
import type { AiUsageMetrics } from "./types";

/** JSON с отсортированными ключами — одинаковый вход даёт одинаковый хэш. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Начало текущих суток в заданном часовом поясе (для квот), как момент UTC. */
export function startOfDayInTz(timeZone: string, now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const elapsedMs = ((get("hour") * 60 + get("minute")) * 60 + get("second")) * 1000 + now.getUTCMilliseconds();
  return new Date(now.getTime() - elapsedMs);
}

export function startOfUtcMonth(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function estimateCostUsd(model: string, paid: boolean, usage: AiUsageMetrics, at: Date = new Date()): number {
  if (!paid) return 0;
  const p = priceOf(model, at);
  const cost =
    ((usage.inputTokens ?? 0) / 1e6) * (p.inPerM ?? 0) +
    ((usage.outputTokens ?? 0) / 1e6) * (p.outPerM ?? 0) +
    ((usage.audioSeconds ?? 0) / 60) * (p.perAudioMin ?? 0) +
    (usage.images ?? 0) * (p.perImage ?? 0);
  return Math.round(cost * 1e6) / 1e6;
}

/** Достаёт JSON из ответа модели (на случай ```json ... ``` обёртки). */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return JSON.parse(fenced?.[1] ?? trimmed);
}
