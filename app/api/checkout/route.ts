import { z } from "zod";
import { findPlan, planExtras } from "@/lib/payments/plans";
import { AccessError } from "@/lib/db/access";
import { createDemoPayments, EXTRAS_KZT } from "@/lib/payments";
import { errorResponse, familyToken, ok, readJson, requireFamily } from "../_family/http";
import { getDemoOrderStore, normalizeExtras } from "./orders";

export const dynamic = "force-dynamic";

const inFlight = new Map<string, Promise<unknown>>();

async function placeOrder(familyId: string, product: "digital" | "print", extras: string[]) {
  const store = getDemoOrderStore();
  const existing = await store.findPaid(familyId, product, extras);
  if (existing) return { orderId: existing.id, status: existing.status, amountKzt: existing.amount_kzt, repeated: true };
  const res = await createDemoPayments(store.save).checkout({ familyId, product, extras });
  return { orderId: res.orderId, status: res.status, amountKzt: res.amountKzt, repeated: false };
}

const Body = z.object({
  plan: z.string().min(1).max(40),
  extras: z.array(z.string().max(40)).max(10).default([]),
});

// POST /api/checkout — демо-оплата по ссылке семьи: { token, plan: "digital-2", extras: ["tale"] }.
// Денег нет: заказ сразу «оплачено (демо)» в demo_orders. Повторное нажатие возвращает тот же заказ.
export async function POST(req: Request) {
  try {
    const raw = await readJson(req);
    const view = await requireFamily(familyToken(req, raw));
    const body = Body.parse(raw ?? {});

    const plan = findPlan(body.plan);
    if (!plan) throw new AccessError("bad_request", "Такого варианта книги нет — выберите, пожалуйста, ещё раз");
    // Семья выбирает только обычные допы; уровни (plan:*) добавляет сервер по выбранному варианту.
    const chosen = body.extras.filter((e) => !e.startsWith("plan:"));
    if (chosen.some((e) => !(e in EXTRAS_KZT))) throw new AccessError("bad_request", "Такого допа нет");
    const extras = normalizeExtras([...planExtras(plan), ...chosen]);

    // Двойной тап приходит двумя запросами почти одновременно: второй ждёт первый и получает тот же заказ.
    const key = `${view.family.id}|${plan.product}|${extras.join(",")}`;
    const prev = inFlight.get(key);
    if (prev) await prev.catch(() => undefined);
    const run = placeOrder(view.family.id, plan.product, extras);
    inFlight.set(key, run);
    try {
      const r = await run;
      return ok({ ...r, plan: plan.id, demo: true }, r.repeated ? 200 : 201);
    } finally {
      if (inFlight.get(key) === run) inFlight.delete(key);
    }
  } catch (e) {
    return errorResponse(e);
  }
}
