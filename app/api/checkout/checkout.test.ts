// Демо-оплата без Supabase (память процесса): цены финмодели, paid_demo, без дублей.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { POST as createFamily } from "../families/route";
import { POST as checkout } from "./route";
import { getDemoOrderStore, MemoryDemoOrderStore } from "./orders";
import { findPlan, PLANS, planOfOrder } from "@/lib/payments/plans";

async function newFamily() {
  const form = new FormData();
  form.set("name", "Книга семьи Ким");
  form.set("storytellerName", "Бабушка Анна");
  form.set("birthYear", "1941");
  const res = await createFamily(new Request("http://localhost/api/families", { method: "POST", body: form }));
  return (await res.json()) as { token: string };
}

function pay(token: string | null, body: unknown) {
  return checkout(
    new Request("http://localhost/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { "x-family-token": token } : {}) },
      body: JSON.stringify(body),
    }),
  );
}

const store = () => getDemoOrderStore() as MemoryDemoOrderStore;

describe("каталог", () => {
  it("уровни и цены совпадают с финмоделью", () => {
    expect(PLANS.map((p) => [p.id, p.priceKzt])).toEqual([
      ["digital-1", 6_900],
      ["digital-2", 14_900],
      ["digital-3", 24_900],
      ["print-1", 39_900],
      ["print-2", 59_900],
    ]);
  });
});

describe("POST /api/checkout", () => {
  it("пишет заказ paid_demo с суммой уровня, повтор не создаёт дубль", async () => {
    const { token } = await newFamily();
    const first = await pay(token, { plan: "digital-3", extras: ["tale"] }); // 24 900 + сказка 6 900
    expect(first.status).toBe(201);
    const a = await first.json();
    expect(a).toMatchObject({ status: "paid_demo", amountKzt: 31_800, demo: true, repeated: false });

    const again = await pay(token, { plan: "digital-3", extras: ["tale", "tale"] });
    expect(again.status).toBe(200);
    expect((await again.json()).orderId).toBe(a.orderId);

    const order = store().orders.find((o) => o.id === a.orderId)!;
    expect(order).toMatchObject({ product: "digital", amount_kzt: 31_800, status: "paid_demo", provider: "demo" });
    expect(planOfOrder(order)?.id).toBe("digital-3");
    expect(store().orders.filter((o) => o.family_id === order.family_id)).toHaveLength(1);
  });

  it("двойной тап (два запроса одновременно) — один заказ", async () => {
    const { token } = await newFamily();
    const [r1, r2] = await Promise.all([pay(token, { plan: "print-2" }), pay(token, { plan: "print-2" })]);
    const [a, b] = [await r1.json(), await r2.json()];
    expect(a.orderId).toBe(b.orderId);
    expect(a.amountKzt).toBe(59_900);
  });

  it("клиент не может подложить уровень или неизвестный доп", async () => {
    const { token } = await newFamily();
    const res = await pay(token, { plan: "digital-1", extras: ["plan:digital-3"] });
    expect((await res.json()).amountKzt).toBe(findPlan("digital-1")!.priceKzt);
    expect((await pay(token, { plan: "digital-1", extras: ["video"] })).status).toBe(400);
    expect((await pay(token, { plan: "gold-9" })).status).toBe(400);
  });

  it("без ссылки семьи — 403", async () => {
    expect((await pay(null, { plan: "digital-1" })).status).toBe(403);
    expect((await pay("0".repeat(64), { plan: "digital-1" })).status).toBe(403);
  });
});
