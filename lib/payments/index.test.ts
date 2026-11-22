import { describe, expect, it } from "vitest";
import {
  B2B_KZT_PER_STORY,
  createDemoPayments,
  DEFAULT_PLAN_ID,
  EXTRAS_KZT,
  planExtraKey,
  PRICES_KZT,
  quoteKzt,
  SOON_EXTRAS_KZT,
} from "./index";
import { EXTRA_OPTIONS, findPlan, PLANS, SOON_EXTRAS } from "./plans";

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

  it("сказка для внуков 6 900 ₸, по умолчанию — «Стандарт» цифровой книги", () => {
    expect(EXTRAS_KZT.tale).toBe(6_900);
    expect(quoteKzt({ product: "digital", extras: [planExtraKey("digital", 2), "tale"] })).toBe(21_800);
    expect(findPlan(DEFAULT_PLAN_ID)).toMatchObject({ title: "Стандарт", fullTitle: "Цифровая · Стандарт", priceKzt: 14_900 });
  });

  it("названия уровней — как на слайде", () => {
    expect(PLANS.map((p) => [p.id, p.fullTitle, p.priceKzt])).toEqual([
      ["digital-1", "Цифровая · Короткая", 6_900],
      ["digital-2", "Цифровая · Стандарт", 14_900],
      ["digital-3", "Цифровая · Полная", 24_900],
      ["print-1", "Печатная · Стандарт", 39_900],
      ["print-2", "Печатная · Подарочная", 59_900],
    ]);
    expect(EXTRA_OPTIONS.map((e) => [e.id, e.priceKzt])).toEqual([["tale", 6_900]]);
  });

  it("допы «скоро» с ценами слайда — оплатить нельзя", () => {
    expect(SOON_EXTRAS_KZT).toEqual({
      copy: 17_900,
      video: 14_900,
      tree: 9_900,
      translation: 4_900,
      archive: 1_490,
      legacy: 89_900,
    });
    expect(SOON_EXTRAS.map((e) => e.id)).toEqual(Object.keys(SOON_EXTRAS_KZT));
    expect(SOON_EXTRAS.find((e) => e.id === "archive")?.per).toBe("/мес");
    for (const id of Object.keys(SOON_EXTRAS_KZT)) expect(id in EXTRAS_KZT).toBe(false);
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
