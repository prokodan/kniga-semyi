import { z } from "zod";
import { env } from "@/lib/env";
import { kioskPinMatches } from "../_lib/pin";
import { startKioskSession } from "../_lib/session";
import { kioskError, ok, readJson } from "../_lib/http";

export const dynamic = "force-dynamic";

const Body = z.object({ pin: z.string().max(64) });

// POST /api/kiosk/login — { pin }. PIN сверяется на сервере с KIOSK_PIN, верный → cookie до полуночи (Алматы).
// Неверный — 401 без подсказок (ни длины, ни «почти»). Небольшая задержка мешает перебору.
export async function POST(req: Request) {
  try {
    const { pin } = Body.parse((await readJson(req)) ?? {});
    if (!env.kioskPin()) return ok({ error: "disabled", message: "Киоск выключен. Обратитесь к администратору." }, 503);
    if (!kioskPinMatches(env.kioskPin(), pin)) {
      await new Promise((r) => setTimeout(r, 700));
      return ok({ error: "forbidden", message: "PIN не подошёл" }, 401);
    }
    await startKioskSession();
    return ok({ ok: true });
  } catch (e) {
    return kioskError(e);
  }
}
