import "server-only";
// Общие куски ручек киоска: проверка входа по PIN, ошибки → HTTP.
import { z } from "zod";
import { errorResponse as familyError, ok } from "../../_family/http";
import { isKiosk } from "./session";
import { KioskError } from "./store";

export { ok, readJson } from "../../_family/http";

export class KioskAuthError extends Error {}

/** Ручка только для планшета, вошедшего по PIN. */
export async function requireKioskApi(): Promise<void> {
  if (!(await isKiosk())) throw new KioskAuthError("Нужно войти по PIN волонтёра");
}

export function kioskError(e: unknown) {
  if (e instanceof KioskAuthError) return ok({ error: "forbidden", message: e.message }, 401);
  if (e instanceof KioskError) return ok({ error: e.code, message: e.message }, e.code === "not_found" ? 404 : 400);
  if (e instanceof z.ZodError) return ok({ error: "bad_request", message: "Проверьте, пожалуйста, поля карточки", issues: e.issues }, 400);
  return familyError(e);
}
