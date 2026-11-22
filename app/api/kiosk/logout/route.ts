import { endKioskSession } from "../_lib/session";
import { ok } from "../_lib/http";

export const dynamic = "force-dynamic";

// POST /api/kiosk/logout — выход с планшета: стирает cookie входа и текущего волонтёра.
export async function POST() {
  await endKioskSession();
  return ok({ ok: true });
}
