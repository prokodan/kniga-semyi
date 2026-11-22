// Демо-заказы семьи (I7): запись в demo_orders, без дублей при повторном нажатии.
// Без Supabase — память процесса (локально и в тестах), как MemoryFamilyStore в lib/db/access.
import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDbOrNull } from "@/lib/db";
import type { SaveDemoOrder } from "@/lib/payments";
import type { DemoOrder, Uuid } from "@/lib/types";

export interface DemoOrderStore {
  save: SaveDemoOrder;
  /** Уже оплаченный (демо) заказ семьи с тем же продуктом и допами — чтобы не плодить дубли. */
  findPaid(familyId: Uuid, product: DemoOrder["product"], extras: string[]): Promise<DemoOrder | null>;
  /** Последний оплаченный (демо) заказ семьи — для экрана допов. */
  latestPaid(familyId: Uuid): Promise<DemoOrder | null>;
}

/** Допы без повторов и в одном порядке: сравнение заказов не зависит от порядка галочек. */
export function normalizeExtras(extras: string[]): string[] {
  return [...new Set(extras)].sort();
}

const sameExtras = (a: string[], b: string[]) => {
  const x = normalizeExtras(a);
  const y = normalizeExtras(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

export class MemoryDemoOrderStore implements DemoOrderStore {
  orders: DemoOrder[] = [];

  save: SaveDemoOrder = async (row) => {
    const order: DemoOrder = { ...row, extras: normalizeExtras(row.extras), id: randomUUID(), created_at: new Date().toISOString() };
    this.orders.push(order);
    return order.id;
  };

  async findPaid(familyId: Uuid, product: DemoOrder["product"], extras: string[]) {
    const o = this.orders.find((x) => x.family_id === familyId && x.status === "paid_demo" && x.product === product && sameExtras(x.extras, extras));
    return o ? structuredClone(o) : null;
  }

  async latestPaid(familyId: Uuid) {
    const o = this.orders.filter((x) => x.family_id === familyId && x.status === "paid_demo").at(-1);
    return o ? structuredClone(o) : null;
  }
}

export class SupabaseDemoOrderStore implements DemoOrderStore {
  constructor(private db: SupabaseClient) {}

  save: SaveDemoOrder = async (row) => {
    const { data, error } = await this.db
      .from("demo_orders")
      .insert({ ...row, extras: normalizeExtras(row.extras) })
      .select("id")
      .single();
    if (error) throw new Error(`demo_orders insert: ${error.message}`);
    return (data as { id: Uuid }).id;
  };

  async findPaid(familyId: Uuid, product: DemoOrder["product"], extras: string[]) {
    const { data, error } = await this.db
      .from("demo_orders")
      .select("*")
      .eq("family_id", familyId)
      .eq("status", "paid_demo")
      .eq("product", product)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(`demo_orders select: ${error.message}`);
    return ((data ?? []) as DemoOrder[]).find((o) => sameExtras(o.extras ?? [], extras)) ?? null;
  }

  async latestPaid(familyId: Uuid) {
    const { data, error } = await this.db
      .from("demo_orders")
      .select("*")
      .eq("family_id", familyId)
      .eq("status", "paid_demo")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`demo_orders select: ${error.message}`);
    return (data as DemoOrder | null) ?? null;
  }
}

const g = globalThis as { __demoOrderStore?: MemoryDemoOrderStore };

export function getDemoOrderStore(): DemoOrderStore {
  const db = getDbOrNull();
  if (db) return new SupabaseDemoOrderStore(db);
  g.__demoOrderStore ??= new MemoryDemoOrderStore(); // переживает hot-reload в dev
  return g.__demoOrderStore;
}
