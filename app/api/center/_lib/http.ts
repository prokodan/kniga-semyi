import "server-only";
// Кабинет АКНЦ (I9): вход по ADMIN_PIN (та же подписанная cookie, что у /admin/ai — один вход на обе админки),
// загрузка сводки для страниц и ручек, ошибки → HTTP.
import { redirect } from "next/navigation";
import { z } from "zod";
import { isAdmin, isAdminConfigured } from "@/app/admin/ai/_lib/session";
import { kioskDayStart } from "@/app/api/kiosk/_lib/pin";
import { ok } from "../../_family/http";
import { CenterError, getCenterSource } from "./source";
import { applyFilter, buildCounters, buildFamilies, buildVolunteers, type CenterFilter } from "./stats";

export { ok, readJson } from "../../_family/http";
export { isAdmin as isCenterAdmin, isAdminConfigured as isCenterConfigured };

export class CenterAuthError extends Error {}

/** Для страниц кабинета: без входа — на экран PIN. */
export async function requireCenter(): Promise<void> {
  if (!(await isAdmin())) redirect("/center");
}

/** Для ручек кабинета. */
export async function requireCenterApi(): Promise<void> {
  if (!(await isAdmin())) throw new CenterAuthError("Нужно войти по PIN администратора на /center");
}

export function centerError(e: unknown) {
  if (e instanceof CenterAuthError) return ok({ error: "forbidden", message: e.message }, 401);
  if (e instanceof CenterError) return ok({ error: e.code, message: e.message }, e.code === "not_found" ? 404 : 400);
  if (e instanceof z.ZodError) return ok({ error: "bad_request", message: "Проверьте, пожалуйста, поля", issues: e.issues }, 400);
  console.error("[center]", e instanceof Error ? e.message : e);
  return ok({ error: "internal", message: "Не удалось прочитать данные. Попробуйте ещё раз." }, 500);
}

/** Вся сводка кабинета: «сегодня» — с полуночи по Алматы. */
export async function loadCenter(filter: CenterFilter = {}, now: Date = new Date()) {
  const source = getCenterSource();
  const rows = applyFilter(await source.rows(), filter);
  const since = kioskDayStart(now);
  return {
    source: source.kind,
    now: now.toISOString(),
    counters: buildCounters(rows, since),
    families: buildFamilies(rows),
    volunteers: buildVolunteers(rows, since),
  };
}

export type CenterData = Awaited<ReturnType<typeof loadCenter>>;
