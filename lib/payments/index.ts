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
 * Цены, ₸. ВРЕМЕННЫЕ — заменить на цены из финансовой модели питча (I7).
 * Один источник цен для экрана оплаты, демо-заказа и слайдов.
 */
export const PRICES_KZT: Record<ProductKind, number> & Record<string, number> = {
  digital: 0,
  print: 0,
};
export const EXTRAS_KZT: Record<string, number> = {
  tale: 0,
};

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
