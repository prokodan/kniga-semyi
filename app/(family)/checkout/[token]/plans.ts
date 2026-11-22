// Каталог экрана оплаты (I7): уровни продукта с подписями. Цены — только из lib/payments (финмодель).
// Можно импортировать и в клиентских компонентах: здесь нет server-only.
import { EXTRAS_KZT, PLAN_PRICES_KZT, planExtraKey, type ProductKind } from "@/lib/payments";

export interface Plan {
  id: string; // "digital-2"
  product: ProductKind;
  tier: number; // 1, 2, 3
  title: string;
  titleKo: string;
  note: string;
  priceKzt: number;
}

// Названия и подписи уровней — рабочие; свериться со слайдом финмодели.
const LABELS: Record<ProductKind, { title: string; titleKo: string; note: string }[]> = {
  digital: [
    { title: "Цифровая книга", titleKo: "디지털 책", note: "PDF A5 на русском и корейском, QR с голосом" },
    { title: "Цифровая · семейная", titleKo: "가족판", note: "Больше глав и рассказчиков для всей семьи" },
    { title: "Цифровая · наследие", titleKo: "유산판", note: "Самая полная книга и архив голосов семьи" },
  ],
  print: [
    { title: "Печатная книга", titleKo: "인쇄본", note: "Настоящая книга в руки + цифровая версия" },
    { title: "Печатная · подарочная", titleKo: "선물판", note: "Подарочное издание к юбилею" },
  ],
};

export const PLANS: Plan[] = (Object.keys(PLAN_PRICES_KZT) as ProductKind[]).flatMap((product) =>
  PLAN_PRICES_KZT[product].map((priceKzt, i) => ({
    id: `${product}-${i + 1}`,
    product,
    tier: i + 1,
    ...(LABELS[product][i] ?? { title: product, titleKo: "", note: "" }),
    priceKzt,
  })),
);

export function findPlan(id: string): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}

/** Допы уровня (plan:*) — служебные, на экране выбирают уровень, а не доп. */
export function planExtras(plan: Plan): string[] {
  return plan.tier > 1 ? [planExtraKey(plan.product, plan.tier)] : [];
}

/** Уровень по сохранённому заказу (product + extras). */
export function planOfOrder(order: { product: ProductKind; extras: string[] }): Plan | undefined {
  const tier = PLANS.filter((p) => p.product === order.product && p.tier > 1).find((p) =>
    order.extras.includes(planExtraKey(p.product, p.tier)),
  );
  return tier ?? PLANS.find((p) => p.product === order.product && p.tier === 1);
}

export interface ExtraOption {
  id: string;
  title: string;
  titleKo: string;
  note: string;
  priceKzt: number;
}

/** Допы, которые семья выбирает на экране оплаты. */
export const EXTRA_OPTIONS: ExtraOption[] = [
  {
    id: "tale",
    title: "Сказка для внуков",
    titleKo: "손주를 위한 동화",
    note: "Добрая сказка по рассказам дедушки с иллюстрациями",
    priceKzt: EXTRAS_KZT.tale ?? 0,
  },
];

export function formatKzt(n: number): string {
  // вручную, а не toLocaleString: одинаково на сервере и в Safari (без расхождений гидратации)
  return `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0")}\u00a0₸`;
}
