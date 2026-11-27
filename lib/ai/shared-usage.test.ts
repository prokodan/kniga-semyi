import { afterEach, describe, expect, it, vi } from "vitest";
import { summarize } from "@/app/admin/ai/_lib/stats";
import { getVercelEnv, env, isAiUsageSinkEnabled, supabaseRef, usageEnv } from "@/lib/env";
import {
  AI_USAGE_HEADER,
  buildUsageSummary,
  remoteUsageSchema,
  SharedUsageStore,
  SUMMARY_CACHE_MS,
  toProdRow,
  usageSecretOk,
} from "./shared-usage";
import { MemoryStore, type UsageRow } from "./store";

const NOW = new Date("2026-11-27T12:00:00Z");
const row = (over: Partial<UsageRow> = {}): UsageRow => ({
  step: "edit",
  provider: "openai",
  model: "gpt-5.4-mini",
  status: "ok",
  cost_usd: 0.01,
  created_at: NOW.toISOString(),
  ...over,
});

function fakeProd(summary = { day: 0.5, month: 3 }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let down = false;
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (down) throw new TypeError("fetch failed");
    if (String(url).endsWith("/summary")) {
      return Response.json({
        day_start: "2026-11-27T00:00:00.000Z",
        month_start: "2026-11-01T00:00:00.000Z",
        spend: { openai: summary, gemini: { day: 0, month: 0 } },
      });
    }
    return Response.json({ ok: true, stored: true });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls, setDown: (v: boolean) => (down = v) };
}

describe("#211 SharedUsageStore (превью → прод)", () => {
  it("пишет строку у себя как staging и отправляет в прод без story_id", async () => {
    const local = new MemoryStore();
    const prod = fakeProd();
    const store = new SharedUsageStore(local, { prodUrl: "https://prod.example", secret: "s3cret", sourceRef: "abcdef123", fetch: prod.fetchImpl });
    await store.recordUsage(row({ story_id: "11111111-1111-1111-1111-111111111111" }));
    expect(local.usage[0]!.env).toBe("staging");
    expect(prod.calls[0]!.url).toBe("https://prod.example/api/ai/usage");
    const headers = prod.calls[0]!.init?.headers as Record<string, string>;
    expect(headers[AI_USAGE_HEADER]).toBe("s3cret");
    const body = JSON.parse(String(prod.calls[0]!.init?.body));
    expect(body.row.story_id).toBeUndefined();
    expect(body.row.env).toBeUndefined();
    expect(body.source_ref).toBe("abcdef123");
    expect(remoteUsageSchema.safeParse(body).success).toBe(true);
  });

  it("сбой прода не роняет шаг: строка остаётся локально, бюджет — по локальной базе", async () => {
    const local = new MemoryStore();
    local.now = () => NOW;
    const prod = fakeProd();
    prod.setDown(true);
    const logs: string[] = [];
    const store = new SharedUsageStore(local, { prodUrl: "https://p", secret: "s", fetch: prod.fetchImpl, log: (m) => logs.push(m), now: () => NOW.getTime() });
    await expect(store.recordUsage(row({ cost_usd: 0.2 }))).resolves.toBeUndefined();
    expect(local.usage).toHaveLength(1);
    expect(await store.spend("openai", new Date("2026-11-27T00:00:00Z"))).toBeCloseTo(0.2);
    expect(logs.join(" ")).toMatch(/не отправлен/);
  });

  it("бюджет дня и месяца — из сводки прода (общий), кэш 60 с + отправленное после сводки", async () => {
    const local = new MemoryStore();
    let t = NOW.getTime();
    const prod = fakeProd({ day: 0.5, month: 3 });
    const store = new SharedUsageStore(local, { prodUrl: "https://p", secret: "s", fetch: prod.fetchImpl, now: () => t });
    const day = new Date("2026-11-27T00:00:00Z");
    const month = new Date("2026-11-01T00:00:00Z");
    expect(await store.spend("openai", day)).toBeCloseTo(0.5);
    expect(await store.spend("openai", month)).toBeCloseTo(3);
    await store.recordUsage(row({ cost_usd: 0.1 }));
    expect(await store.spend("openai", day)).toBeCloseTo(0.6);
    const summaryCalls = () => prod.calls.filter((c) => c.url.endsWith("/summary")).length;
    expect(summaryCalls()).toBe(1);
    t += SUMMARY_CACHE_MS + 1;
    expect(await store.spend("openai", day)).toBeCloseTo(0.5); // свежая сводка уже включает отправленное
    expect(summaryCalls()).toBe(2);
    // Окно не совпало со сводкой (например, полночь) — считаем локально
    expect(await store.spend("openai", new Date("2026-11-26T00:00:00Z"))).toBeCloseTo(0.1);
  });

  it("квоты и остывание — локальные", async () => {
    const local = new MemoryStore();
    local.now = () => NOW;
    const store = new SharedUsageStore(local, { prodUrl: "https://p", secret: "s", fetch: fakeProd().fetchImpl });
    await store.recordUsage(row({ status: "rate_limited", provider: "gemini", model: "g" }));
    expect(await store.hadFailureSince("gemini", "g", new Date(NOW.getTime() - 60_000), ["rate_limited"])).toBe(true);
  });
});

describe("#211 приём в проде", () => {
  it("секрет сравнивается целиком; без секрета на сервере — закрыто", () => {
    expect(usageSecretOk("abc", "abc")).toBe(true);
    expect(usageSecretOk("abd", "abc")).toBe(false);
    expect(usageSecretOk("abc", undefined)).toBe(false);
    expect(usageSecretOk(null, "abc")).toBe(false);
  });

  it("строка staging: env=staging, без story_id, время не из будущего и не старше суток", () => {
    const parsed = remoteUsageSchema.parse({ row: { ...row(), story_id: "x", created_at: "2030-01-01T00:00:00Z" } });
    const r = toProdRow(parsed, NOW);
    expect(r.env).toBe("staging");
    expect(r).not.toHaveProperty("story_id", "x");
    expect(r.created_at).toBe(NOW.toISOString());
    expect(toProdRow(remoteUsageSchema.parse({ row: row() }), NOW).created_at).toBe(NOW.toISOString());
  });

  it("отвергает мусор: отрицательная цена, неизвестный статус", () => {
    expect(remoteUsageSchema.safeParse({ row: row({ cost_usd: -1 }) }).success).toBe(false);
    expect(remoteUsageSchema.safeParse({ row: { ...row(), status: "free" } }).success).toBe(false);
  });

  it("сводка — сутки и месяц UTC по всем строкам (prod + staging)", async () => {
    const m = new MemoryStore();
    await m.recordUsage(row({ cost_usd: 0.3 }));
    await m.recordUsage(row({ cost_usd: 0.2, env: "staging" }));
    await m.recordUsage(row({ cost_usd: 1, created_at: "2026-11-05T00:00:00Z" }));
    const s = await buildUsageSummary(m, NOW);
    expect(s.day_start).toBe("2026-11-27T00:00:00.000Z");
    expect(s.spend.openai!.day).toBeCloseTo(0.5);
    expect(s.spend.openai!.month).toBeCloseTo(1.5);
    expect(s.spend.mock).toBeUndefined();
  });
});

describe("#211 /admin/ai — расход по окружениям", () => {
  it("делит по env, строки без env — prod; итог общий", () => {
    const rows = [
      { ...row({ cost_usd: 0.3 }), env: null },
      { ...row({ cost_usd: 0.2 }), env: "staging" },
    ].map((r) => ({ ...r, created_at: r.created_at! }));
    const s = summarize({ rows, routes: [], providers: [], now: NOW });
    expect(s.byEnv.find((e) => e.env === "prod")?.today).toBeCloseTo(0.3);
    expect(s.byEnv.find((e) => e.env === "staging")?.today).toBeCloseTo(0.2);
    expect(s.totals.today).toBeCloseTo(0.5);
  });
});

describe("#211 lib/env", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("на превью ссылки — от адреса превью, расход шлётся при секрете; на проде — PROD_URL и не шлётся", () => {
    vi.stubEnv("PROD_URL", "https://kniga-semyi.vercel.app");
    vi.stubEnv("AI_USAGE_SECRET", "x");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_BRANCH_URL", "kniga-semyi-git-z6-x.vercel.app");
    expect(getVercelEnv()).toBe("preview");
    expect(env.prodUrl()).toBe("https://kniga-semyi-git-z6-x.vercel.app");
    expect(env.productionUrl()).toBe("https://kniga-semyi.vercel.app");
    expect(usageEnv()).toBe("staging");
    expect(isAiUsageSinkEnabled()).toBe(true);

    vi.stubEnv("VERCEL_ENV", "production");
    expect(env.prodUrl()).toBe("https://kniga-semyi.vercel.app");
    expect(usageEnv()).toBe("prod");
    expect(isAiUsageSinkEnabled()).toBe(false);
  });

  it("превью без AI_USAGE_SECRET — отправка выключена", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("PROD_URL", "https://p");
    vi.stubEnv("AI_USAGE_SECRET", "");
    expect(isAiUsageSinkEnabled()).toBe(false);
  });

  it("ref Supabase — поддомен, короткий — 6 символов", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnop.supabase.co");
    expect(supabaseRef()).toBe("abcdefghijklmnop");
    expect(env.supabaseRefShort()).toBe("abcdef");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    expect(supabaseRef()).toBe("local");
  });
});
