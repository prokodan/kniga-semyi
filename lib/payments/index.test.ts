import { describe, expect, it } from "vitest";
import { createDemoPayments, EXTRAS_KZT, PRICES_KZT } from "./index";

describe("demo payments", () => {
  it("сразу отмечает заказ как оплаченный (демо) и считает сумму", async () => {
    const saved: unknown[] = [];
    const pay = createDemoPayments(async (row) => {
      saved.push(row);
      return "order-1";
    });
    const res = await pay.checkout({ familyId: "f1", product: "print", extras: ["tale"] });
    expect(res.status).toBe("paid_demo");
    expect(res.redirectUrl).toBeNull();
    expect(res.amountKzt).toBe(PRICES_KZT.print + (EXTRAS_KZT.tale ?? 0));
    expect(saved).toHaveLength(1);
  });
});
