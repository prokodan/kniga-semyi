// Общие куски API-ручек семьи (I1): токен из ссылки, разбор тела, ошибки → HTTP.
import { NextResponse } from "next/server";
import { z } from "zod";
import { AccessError, getFamilyStore, type FamilyView } from "@/lib/db/access";

const STATUS: Record<AccessError["code"], number> = {
  bad_request: 400,
  forbidden: 403,
  not_found: 404,
  consent_required: 409,
};

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const data: unknown = await req.json();
    return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Токен семьи: заголовок x-family-token или поле token в теле. */
export function familyToken(req: Request, body: { token?: unknown } | null): string | undefined {
  const header = req.headers.get("x-family-token");
  if (header) return header;
  return typeof body?.token === "string" ? body.token : undefined;
}

/** Семья по токену или AccessError("forbidden"). */
export async function requireFamily(token: string | undefined): Promise<FamilyView> {
  if (!token) throw new AccessError("forbidden", "Нужна ссылка семьи");
  const view = await getFamilyStore().getFamilyByToken(token);
  if (!view) throw new AccessError("forbidden", "Ссылка семьи не подходит. Откройте её ещё раз из сообщения.");
  return view;
}

export function errorResponse(e: unknown) {
  if (e instanceof AccessError) return ok({ error: e.code, message: e.message }, STATUS[e.code]);
  if (e instanceof z.ZodError) return ok({ error: "bad_request", message: "Проверьте, пожалуйста, поля формы", issues: e.issues }, 400);
  console.error("[family]", e instanceof Error ? e.message : e);
  return ok({ error: "internal", message: "Что-то пошло не так. Попробуйте ещё раз через минуту." }, 500);
}
