// Общие куски API-ручек интервью: разбор тела, токен семьи, ошибки → HTTP.
import { NextResponse } from "next/server";
import { z } from "zod";
import { InterviewError } from "./engine";

const STATUS: Record<InterviewError["code"], number> = {
  bad_request: 400,
  forbidden: 403,
  not_found: 404,
  finished: 409,
  not_ready: 409,
};

/** Токен семьи из ссылки: заголовок x-family-token или поле token в теле. */
export function familyToken(req: Request, body: { token?: unknown } | null): string | undefined {
  const header = req.headers.get("x-family-token");
  if (header) return header;
  return typeof body?.token === "string" ? body.token : undefined;
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const data: unknown = await req.json();
    return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

export function errorResponse(e: unknown) {
  if (e instanceof InterviewError) return ok({ error: e.code, message: e.message }, STATUS[e.code]);
  if (e instanceof z.ZodError) return ok({ error: "bad_request", message: "Неверный запрос", issues: e.issues }, 400);
  console.error("[interview]", e instanceof Error ? e.message : e);
  return ok({ error: "internal", message: "Что-то пошло не так. Ваш рассказ сохранён, попробуйте ещё раз." }, 500);
}
