// Каталог экрана оплаты и допов = слайды питча: названия и подписи. Цены — только из lib/payments/index.ts.
// Можно импортировать и в клиентских компонентах: здесь нет server-only.
import {
  DEFAULT_PLAN_ID,
  EXTRAS_KZT,
  PLAN_PRICES_KZT,
  planExtraKey,
  SOON_EXTRAS_KZT,
  type ProductKind,
  type SoonExtraId,
} from "./index";

export { DEFAULT_PLAN_ID };

export interface Plan {
  id: string; // "digital-2"
  product: ProductKind;
  tier: number; // 1, 2, 3
  /** Название уровня со слайда: «Стандарт» */
  title: string;
  /** С видом книги — для чека и «Оплачено»: «Цифровая · Стандарт» */
  fullTitle: string;
  titleKo: string;
  note: string;
  priceKzt: number;
}

export const PRODUCT_TITLES: Record<ProductKind, { title: string; short: string; titleKo: string }> = {
  digital: { title: "Цифровая книга", short: "Цифровая", titleKo: "디지털 책" },
  print: { title: "Печатная книга", short: "Печатная", titleKo: "인쇄본" },
};

// Названия уровней — как на слайде питча.
const LABELS: Record<ProductKind, { title: string; titleKo: string; note: string }[]> = {
  digital: [
    { title: "Короткая", titleKo: "짧은 책", note: "PDF на русском и корейском, QR с голосом к каждой главе" },
    { title: "Стандарт", titleKo: "표준", note: "Вся жизнь по карте: детство, юность, семья, традиции" },
    { title: "Полная", titleKo: "완전판", note: "Самая полная книга: больше глав, рассказчиков и фото" },
  ],
  print: [
    { title: "Стандарт", titleKo: "표준", note: "Настоящая книга в руки + цифровая версия" },
    { title: "Подарочная", titleKo: "선물판", note: "Подарочное издание в твёрдой обложке — к юбилею" },
  ],
};

export const PLANS: Plan[] = (Object.keys(PLAN_PRICES_KZT) as ProductKind[]).flatMap((product) =>
  PLAN_PRICES_KZT[product].map((priceKzt, i) => ({
    id: `${product}-${i + 1}`,
    product,
    tier: i + 1,
    ...(LABELS[product][i] ?? { title: product, titleKo: "", note: "" }),
    fullTitle: `${PRODUCT_TITLES[product].short} · ${LABELS[product][i]?.title ?? product}`,
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
    note: "Добрая сказка по настоящим рассказам — с иллюстрациями в одном стиле",
    priceKzt: EXTRAS_KZT.tale ?? 0,
  },
];

export interface SoonExtra extends ExtraOption {
  id: SoonExtraId;
  /** «/мес» у подписки */
  per?: string;
}

/** Допы «скоро» со слайда питча: показываем цену, оплатить пока нельзя. */
export const SOON_EXTRAS: SoonExtra[] = (
  [
    { id: "copy", title: "Ещё экземпляр", titleKo: "추가 인쇄본", note: "Печатная книга для каждой ветви семьи" },
    { id: "video", title: "Видеоистория", titleKo: "영상 이야기", note: "Фото и живой голос — короткий фильм о жизни рассказчика" },
    { id: "tree", title: "Семейное древо", titleKo: "가계도", note: "Имена, даты и места из рассказов — в одном древе" },
    { id: "translation", title: "Перевод KZ / EN", titleKo: "카자흐어 · 영어 번역", note: "Ещё два языка — для внуков, которые живут далеко" },
    { id: "archive", title: "«Семейный архив»", titleKo: "가족 기록 보관소", note: "Новые записи, голоса и главы — книга растёт вместе с семьёй", per: "/мес" },
    { id: "legacy", title: "Пакет «Наследие»", titleKo: "유산 패키지", note: "Книга, печать и допы одним подарком — для всей семьи" },
  ] satisfies Omit<SoonExtra, "priceKzt">[]
).map((e) => ({ ...e, priceKzt: SOON_EXTRAS_KZT[e.id] }));

export function formatKzt(n: number): string {
  // вручную, а не toLocaleString: одинаково на сервере и в Safari (без расхождений гидратации)
  return `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0")}\u00a0₸`;
}
