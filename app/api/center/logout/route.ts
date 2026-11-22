import { endAdminSession } from "@/app/admin/ai/_lib/session";
import { ok } from "../_lib/http";

export const dynamic = "force-dynamic";

// POST /api/center/logout — выход из кабинета (и из /admin/ai: cookie общая).
export async function POST() {
  await endAdminSession();
  return ok({ ok: true });
}
