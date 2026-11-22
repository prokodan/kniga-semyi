import { z } from "zod";
import { clientIp, tryAdminPin } from "@/app/admin/ai/_lib/attempts";
import { pinMatches } from "@/app/admin/ai/_lib/pin";
import { startAdminSession } from "@/app/admin/ai/_lib/session";
import { env } from "@/lib/env";
import { centerError, ok, readJson } from "../_lib/http";

export const dynamic = "force-dynamic";

const Body = z.object({ pin: z.string().max(64) });

// POST /api/center/login — { pin }. PIN сверяется на сервере с ADMIN_PIN; верный → cookie админки на 12 ч.
// Неверный — 401 без подсказок, с паузой против перебора; 5 неверных за 10 минут с одного IP → 429 (#56).
export async function POST(req: Request) {
  try {
    const { pin } = Body.parse((await readJson(req)) ?? {});
    if (!env.adminPin()) return ok({ error: "disabled", message: "Кабинет выключен: нужно задать ADMIN_PIN." }, 503);
    const r = await tryAdminPin(pin, clientIp(req.headers), (p) => pinMatches(env.adminPin(), p));
    if (!r.ok) return ok({ error: r.status === 429 ? "too_many" : "forbidden", message: r.message, left: r.left }, r.status);
    await startAdminSession();
    return ok({ ok: true });
  } catch (e) {
    return centerError(e);
  }
}
