import { describe, expect, it } from "vitest";
import { B2B_KZT_PER_STORY, createDemoPayments, EXTRAS_KZT, planExtraKey, PRICES_KZT, quoteKzt } from "./index";

describe("цены из финмодели", () => {
  it("цифровая книга 6 900 / 14 900 / 24 900 ₸", () => {
    expect(quoteKzt({ product: "digital", extras: [] })).toBe(6_900);
    expect(quoteKzt({ product: "digital", extras: [planExtraKey("digital", 2)] })).toBe(14_900);
    expect(quoteKzt({ product: "digital", extras: [planExtraKey("digital", 3)] })).toBe(24_900);
  });

  it("печатная книга 39 900 / 59 900 ₸, B2B АКНЦ 25 000 ₸ за историю", () => {
    expect(quoteKzt({ product: "print", extras: [] })).toBe(39_900);
    expect(quoteKzt({ product: "print", extras: [planExtraKey("print", 2)] })).toBe(59_900);
    expect(B2B_KZT_PER_STORY).toBe(25_000);
  });

  it("неизвестный доп не меняет сумму", () => {
    expect(quoteKzt({ product: "print", extras: ["plan:print-9", "nope"] })).toBe(39_900);
  });
});

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
