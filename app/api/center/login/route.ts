import { z } from "zod";
import { pinMatches } from "@/app/admin/ai/_lib/pin";
import { startAdminSession } from "@/app/admin/ai/_lib/session";
import { env } from "@/lib/env";
import { centerError, ok, readJson } from "../_lib/http";

export const dynamic = "force-dynamic";

const Body = z.object({ pin: z.string().max(64) });

// POST /api/center/login — { pin }. PIN сверяется на сервере с ADMIN_PIN; верный → cookie админки на 12 ч.
// Неверный — 401 без подсказок, с паузой против перебора.
export async function POST(req: Request) {
  try {
    const { pin } = Body.parse((await readJson(req)) ?? {});
    if (!env.adminPin()) return ok({ error: "disabled", message: "Кабинет выключен: нужно задать ADMIN_PIN." }, 503);
    if (!pinMatches(env.adminPin(), pin)) {
      await new Promise((r) => setTimeout(r, 800));
      return ok({ error: "forbidden", message: "PIN не подошёл" }, 401);
    }
    await startAdminSession();
    return ok({ ok: true });
  } catch (e) {
    return centerError(e);
  }
}
