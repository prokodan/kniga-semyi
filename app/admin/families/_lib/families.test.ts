// #201: админка «Семьи» — главы готово / всего, книга, цена по заказу (тариф + допы), расход ИИ, фильтры.
import { describe, expect, it } from "vitest";
import { buildAdminFamilies, filterAdminFamilies, priceLabel, priceOfOrder, totals, type AdminFamilyRows } from "./families";

const OLD = "2026-11-20T10:00:00Z";
const NEW = "2026-11-25T10:00:00Z";

function rows(): AdminFamilyRows {
  return {
    families: [
      { id: "aaaaaaaa-1", name: "Ким", source: "family", is_demo: false, access_token: "tok/a", created_at: OLD },
      { id: "bbbbbbbb-2", name: "Ли", source: "kiosk", is_demo: false, access_token: "tok-b", created_at: NEW },
      { id: "cccccccc-3", name: "Демо", source: "family", is_demo: true, access_token: "tok-c", created_at: OLD },
    ],
    stories: [
      { id: "s1", family_id: "aaaaaaaa-1", status: "ready", parent_story_id: null },
      { id: "s2", family_id: "aaaaaaaa-1", status: "editing", parent_story_id: null },
      { id: "s3", family_id: "aaaaaaaa-1", status: "ready", parent_story_id: "s1" }, // уточнение — не глава
      { id: "s4", family_id: "aaaaaaaa-1", status: "skipped", parent_story_id: null }, // отказ — не глава
      { id: "s5", family_id: "bbbbbbbb-2", status: "failed", parent_story_id: null },
    ],
    books: [
      { family_id: "aaaaaaaa-1", status: "failed", page_count: null, created_at: OLD },
      { family_id: "aaaaaaaa-1", status: "ready", page_count: 18, created_at: NEW },
    ],
    orders: [
      { family_id: "aaaaaaaa-1", product: "digital", amount_kzt: 6_900, extras: [], status: "paid_demo", created_at: OLD },
      { family_id: "aaaaaaaa-1", product: "digital", amount_kzt: 21_800, extras: ["plan:digital-2", "tale"], status: "paid_demo", created_at: NEW },
      { family_id: "bbbbbbbb-2", product: "print", amount_kzt: 39_900, extras: [], status: "cancelled", created_at: NEW },
    ],
    usage: [
      { story_id: "s1", cost_usd: "0.0125" },
      { story_id: "s3", cost_usd: 0.0025 },
      { story_id: "s5", cost_usd: 0.001 },
      { story_id: null, cost_usd: 5 },
      { story_id: "чужая", cost_usd: 1 },
    ],
  };
}

describe("админка «Семьи»", () => {
  it("главы готово / всего без уточнений и отказов; последняя книга; новые сверху", () => {
    const list = buildAdminFamilies(rows());
    expect(list.map((f) => f.shortId)).toEqual(["bbbbbbbb", "aaaaaaaa", "cccccccc"]);
    const kim = list[1]!;
    expect(kim.chapters).toEqual({ ready: 1, total: 2, failed: 0 });
    expect(kim.book).toEqual({ status: "ready", pages: 18 });
    expect(list[0]!.chapters).toEqual({ ready: 0, total: 1, failed: 1 });
    expect(list[2]!.book.status).toBe("none");
  });

  it("цена: последний оплаченный заказ — тариф + допы; отменённый не считается → «не выбран»", () => {
    const [li, kim, demo] = buildAdminFamilies(rows());
    expect(kim!.price).toEqual({ plan: "Цифровая · Стандарт", extras: ["Сказка для внуков"], amountKzt: 21_800, status: "оплачено (демо)" });
    expect(priceLabel(kim!.price)).toBe("Цифровая · Стандарт + Сказка для внуков = 21 800 ₸");
    expect(li!.price).toBeNull();
    expect(demo!.price).toBeNull();
    expect(priceLabel(null)).toBe("не выбран");
  });

  it("тариф первого уровня без допов", () => {
    expect(priceOfOrder({ product: "print", extras: [], amount_kzt: 39_900, status: "paid_demo" }).plan).toBe("Печатная · Стандарт");
  });

  it("расход ИИ — по story_id своих историй; ссылки с токеном (экранирован)", () => {
    const [li, kim] = buildAdminFamilies(rows());
    expect(kim!.aiUsd).toBe(0.015);
    expect(li!.aiUsd).toBe(0.001);
    expect(kim!.links).toEqual({ family: "/f/tok%2Fa", book: "/book/tok%2Fa", names: "/f/tok%2Fa/names" });
  });

  it("фильтр по источнику и демо; итоги", () => {
    const list = buildAdminFamilies(rows());
    expect(filterAdminFamilies(list, "kiosk", false).map((f) => f.name)).toEqual(["Ли"]);
    expect(filterAdminFamilies(list, "family", true).map((f) => f.name)).toEqual(["Ким"]);
    const t = totals(filterAdminFamilies(list, "all", false));
    expect(t).toMatchObject({ families: 3, family: 2, kiosk: 1, withOrder: 1, ordersKzt: 21_800, readyChapters: 1 });
  });
});
