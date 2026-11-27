// #201: наша админка «Семьи» (/admin/families) — все семьи (family и kiosk): источник, главы готово / всего,
// статус книги, цена книги (тариф + допы из demo_orders), расход ИИ, быстрые ссылки.
// Чистая сборка из строк — без next/* и без базы, проверяется тестами. Загрузка строк — ./load.ts.
import { EXTRA_OPTIONS, formatKzt, planOfOrder, PRODUCT_TITLES } from "@/lib/payments/plans";
import type { BookStatus, DemoOrder, Family, Story } from "@/lib/types";

export type FamilyPick = Pick<Family, "id" | "name" | "source" | "is_demo" | "access_token" | "created_at" | "labs">;
export type StoryPick = Pick<Story, "id" | "family_id" | "status" | "parent_story_id">;
export type BookPick = { family_id: string; status: BookStatus; page_count: number | null; created_at: string };
export type OrderPick = Pick<DemoOrder, "family_id" | "product" | "amount_kzt" | "extras" | "status" | "created_at">;
export type UsagePick = { story_id: string | null; cost_usd: number | string | null };

export interface AdminFamilyRows {
  families: FamilyPick[];
  stories: StoryPick[];
  books: BookPick[];
  orders: OrderPick[];
  usage: UsagePick[];
}

export interface FamilyPrice {
  /** «Цифровая · Стандарт» */
  plan: string;
  /** Допы, кроме уровня тарифа: «Сказка для внуков» */
  extras: string[];
  amountKzt: number;
  /** «оплачено (демо)» / «создан» */
  status: string;
}

export interface AdminFamily {
  id: string;
  shortId: string;
  name: string;
  source: Family["source"];
  isDemo: boolean;
  createdAt: string;
  /** Главы: основные истории без пропущенных (skipped); готово — status = ready */
  chapters: { ready: number; total: number; failed: number };
  book: { status: BookStatus | "none"; pages: number | null };
  /** null — заказа нет («не выбран») */
  price: FamilyPrice | null;
  aiUsd: number;
  links: { family: string; book: string; names: string };
  /** #223: флаги, включённые семье (families.labs), как в базе — в том числе неизвестные реестру. */
  labs: string[];
}

export const ORDER_STATUS: Record<DemoOrder["status"], string> = {
  paid_demo: "оплачено (демо)",
  created: "создан, не оплачен",
  cancelled: "отменён",
};

const EXTRA_TITLE = new Map(EXTRA_OPTIONS.map((e) => [e.id, e.title]));

/** Цена книги по заказу: тариф (product + plan:*) и остальные допы. Сумма — как записана в заказе. */
export function priceOfOrder(o: Pick<OrderPick, "product" | "extras" | "amount_kzt" | "status">): FamilyPrice {
  const extras = Array.isArray(o.extras) ? o.extras : [];
  const plan = planOfOrder({ product: o.product, extras });
  return {
    plan: plan?.fullTitle ?? PRODUCT_TITLES[o.product]?.title ?? o.product,
    extras: extras.filter((e) => !e.startsWith("plan:")).map((e) => EXTRA_TITLE.get(e) ?? e),
    amountKzt: Number(o.amount_kzt) || 0,
    status: ORDER_STATUS[o.status] ?? o.status,
  };
}

export function priceLabel(p: FamilyPrice | null): string {
  if (!p) return "не выбран";
  return [p.plan, ...p.extras].join(" + ") + ` = ${formatKzt(p.amountKzt)}`;
}

/** Последний действующий заказ семьи: оплаченный (демо) важнее созданного; отменённые не считаются. */
function latestOrders(orders: OrderPick[]): Map<string, OrderPick> {
  const rank = (o: OrderPick) => (o.status === "paid_demo" ? 1 : 0);
  const m = new Map<string, OrderPick>();
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    const cur = m.get(o.family_id);
    if (!cur || rank(o) > rank(cur) || (rank(o) === rank(cur) && o.created_at > cur.created_at)) m.set(o.family_id, o);
  }
  return m;
}

function latestBooks(books: BookPick[]): Map<string, BookPick> {
  const m = new Map<string, BookPick>();
  for (const b of books) {
    const cur = m.get(b.family_id);
    if (!cur || b.created_at > cur.created_at) m.set(b.family_id, b);
  }
  return m;
}

export function buildAdminFamilies(r: AdminFamilyRows): AdminFamily[] {
  const books = latestBooks(r.books);
  const orders = latestOrders(r.orders);
  const familyOfStory = new Map(r.stories.map((s) => [s.id, s.family_id]));
  const ai = new Map<string, number>();
  for (const u of r.usage) {
    const fam = u.story_id ? familyOfStory.get(u.story_id) : undefined;
    if (fam) ai.set(fam, (ai.get(fam) ?? 0) + (Number(u.cost_usd) || 0));
  }
  const chapters = new Map<string, AdminFamily["chapters"]>();
  for (const s of r.stories) {
    if (s.parent_story_id || s.status === "skipped") continue; // уточнение — часть основной; отказ — главы не будет
    const c = chapters.get(s.family_id) ?? { ready: 0, total: 0, failed: 0 };
    c.total += 1;
    if (s.status === "ready") c.ready += 1;
    if (s.status === "failed") c.failed += 1;
    chapters.set(s.family_id, c);
  }
  return [...r.families]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((f): AdminFamily => {
      const t = encodeURIComponent(f.access_token);
      const b = books.get(f.id);
      const o = orders.get(f.id);
      return {
        id: f.id,
        shortId: f.id.slice(0, 8),
        name: f.name,
        source: f.source,
        isDemo: f.is_demo,
        createdAt: f.created_at,
        chapters: chapters.get(f.id) ?? { ready: 0, total: 0, failed: 0 },
        book: { status: b?.status ?? "none", pages: b?.page_count ?? null },
        price: o ? priceOfOrder(o) : null,
        aiUsd: Math.round((ai.get(f.id) ?? 0) * 10_000) / 10_000,
        links: { family: `/f/${t}`, book: `/book/${t}`, names: `/f/${t}/names` },
        labs: Array.isArray(f.labs) ? [...f.labs] : [],
      };
    });
}

export type SourceView = "all" | "family" | "kiosk";

export function filterAdminFamilies(list: AdminFamily[], view: SourceView, hideDemo: boolean): AdminFamily[] {
  return list.filter((f) => (view === "all" || f.source === view) && !(hideDemo && f.isDemo));
}

export interface AdminFamiliesTotals {
  families: number;
  family: number;
  kiosk: number;
  withOrder: number;
  /** Сумма цен книг по заказам (демо — денег нет) */
  ordersKzt: number;
  readyChapters: number;
  aiUsd: number;
}

export function totals(list: AdminFamily[]): AdminFamiliesTotals {
  return {
    families: list.length,
    family: list.filter((f) => f.source === "family").length,
    kiosk: list.filter((f) => f.source === "kiosk").length,
    withOrder: list.filter((f) => f.price).length,
    ordersKzt: list.reduce((s, f) => s + (f.price?.amountKzt ?? 0), 0),
    readyChapters: list.reduce((s, f) => s + f.chapters.ready, 0),
    aiUsd: Math.round(list.reduce((s, f) => s + f.aiUsd, 0) * 100) / 100,
  };
}

/** #223: сколько семей с флагом в labs — для списка флагов в /admin/families. */
export function labsCount(list: AdminFamily[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const f of list) for (const l of new Set(f.labs)) m.set(l, (m.get(l) ?? 0) + 1);
  return m;
}
