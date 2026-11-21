// Общие куски API-ручек конвейера: ошибки → HTTP.
import { z } from "zod";
import { ok } from "@/lib/interview/http";
import { PipelineError } from "./engine";

const STATUS: Record<PipelineError["code"], number> = { not_found: 404, forbidden: 403, bad_request: 400 };

export function pipelineError(e: unknown) {
  if (e instanceof PipelineError) return ok({ error: e.code, message: e.message }, STATUS[e.code]);
  if (e instanceof z.ZodError) return ok({ error: "bad_request", message: "Неверный запрос", issues: e.issues }, 400);
  console.error("[pipeline]", e instanceof Error ? e.message : e);
  return ok({ error: "internal", message: "Что-то пошло не так. Запись сохранена — попробуйте ещё раз." }, 500);
}
