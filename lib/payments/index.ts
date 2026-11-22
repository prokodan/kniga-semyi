// Порт оплаты. В MLP — только демо-адаптер: «оплачено (демо)», денег нет.
// Настоящие Kaspi / Freedom / Telegram Stars — новые адаптеры этого же интерфейса после конкурса.
// Владелец интерфейса — Z6, экраны оплаты и допов — Z4 (I7).
import type { DemoOrder, Uuid } from "@/lib/types";

export type ProductKind = "digital" | "print";

export interface CheckoutRequest {
  familyId: Uuid;
  product: ProductKind;
  extras: string[];
}

export interface CheckoutResult {
  orderId: Uuid | null;
  status: DemoOrder["status"];
  amountKzt: number;
  /** Для настоящих провайдеров — ссылка на оплату; у демо всегда null */
  redirectUrl: string | null;
}

export interface PaymentPort {
  readonly name: string;
  quote(req: CheckoutRequest): number;
  checkout(req: CheckoutRequest): Promise<CheckoutResult>;
}

/**
 * Цены, ₸, из финансовой модели питча (I7). Один источник для экрана оплаты, демо-заказа и слайдов.
 * Уровни: цифровая книга 6 900 / 14 900 / 24 900, печатная 39 900 / 59 900.
 */
export const PLAN_PRICES_KZT = {
  digital: [6_900, 14_900, 24_900],
  print: [39_900, 59_900],
} as const satisfies Record<ProductKind, readonly number[]>;

/** B2B: АКНЦ платит за каждую записанную историю (кабинет центра, слайд модели). */
export const B2B_KZT_PER_STORY = 25_000;

/** Базовая цена продукта = первый уровень. */
export const PRICES_KZT: Record<ProductKind, number> & Record<string, number> = {
  digital: PLAN_PRICES_KZT.digital[0],
  print: PLAN_PRICES_KZT.print[0],
};

/** Ключ допа «уровень N продукта» (N ≥ 2): доплата до цены уровня, интерфейс порта не меняется. */
export function planExtraKey(product: ProductKind, tier: number): string {
  return `plan:${product}-${tier}`;
}

const planUpgrades: Record<string, number> = Object.fromEntries(
  (Object.keys(PLAN_PRICES_KZT) as ProductKind[]).flatMap((p) =>
    PLAN_PRICES_KZT[p].slice(1).map((price, i) => [planExtraKey(p, i + 2), price - PRICES_KZT[p]]),
  ),
);

/** Допы, которые можно оплатить уже сейчас (слайд питча). */
export const EXTRAS_KZT: Record<string, number> = {
  tale: 6_900,
  ...planUpgrades,
};

/**
 * Допы «скоро» со слайда питча: цена видна, оплатить пока нельзя (их нет в EXTRAS_KZT — сервер отклонит).
 * archive — подписка, ₸ в месяц.
 */
export const SOON_EXTRAS_KZT = {
  copy: 17_900,
  video: 14_900,
  tree: 9_900,
  translation: 4_900,
  archive: 1_490,
  legacy: 89_900,
} as const;

export type SoonExtraId = keyof typeof SOON_EXTRAS_KZT;

/** Уровень, выбранный на экране оплаты по умолчанию: «Стандарт» цифровой книги. */
export const DEFAULT_PLAN_ID = "digital-2";

export function quoteKzt(req: Pick<CheckoutRequest, "product" | "extras">): number {
  return (PRICES_KZT[req.product] ?? 0) + req.extras.reduce((s, e) => s + (EXTRAS_KZT[e] ?? 0), 0);
}

/** Куда сохранить демо-заказ. В проде — insert в demo_orders (I7), в тестах — память. */
export type SaveDemoOrder = (row: Omit<DemoOrder, "id" | "created_at">) => Promise<Uuid | null>;

export function createDemoPayments(save: SaveDemoOrder): PaymentPort {
  return {
    name: "demo",
    quote: quoteKzt,
    async checkout(req) {
      const amountKzt = quoteKzt(req);
      const orderId = await save({
        family_id: req.familyId,
        product: req.product,
        amount_kzt: amountKzt,
        extras: req.extras,
        status: "paid_demo",
        provider: "demo",
        paid_at: new Date().toISOString(),
      });
      return { orderId, status: "paid_demo", amountKzt, redirectUrl: null };
    },
  };
}
