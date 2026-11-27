import { afterEach, describe, expect, it, vi } from "vitest";
import { summarize } from "@/app/admin/ai/_lib/stats";
import { getVercelEnv, env, isAiUsageSinkEnabled, supabaseRef, usageEnv } from "@/lib/env";
import { AI_USAGE_HEADER, remoteUsageSchema, SharedUsageStore, toProdRow, usageSecretOk } from "./shared-usage";
import { isOwnUsage, MemoryStore, type UsageRow } from "./store";

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

function fakeProd() {
  const calls: { url: string; init?: RequestInit }[] = [];
  let down = false;
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (down) throw new TypeError("fetch failed");
    return Response.json({ ok: true, stored: true });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls, setDown: (v: boolean) => (down = v) };
}

describe("#211 SharedUsageStore (превью → прод)", () => {
  it("пишет строку у себя как staging и отправляет в прод без story_id", async () => {
    const local = new MemoryStore();
    const prod = fakeProd();
    const store = new SharedUsageStore(local, { prodUrl: "https://prod.example", secret: "s3cret", sourceRef: "abcdef123", fetch: prod.fetchImpl });
    await store.recordUsage(
      row({ story_id: "11111111-1111-1111-1111-111111111111", family_id: "22222222-2222-2222-2222-222222222222" }),
    );
    expect(local.usage[0]!.env).toBe("staging");
    expect(local.usage[0]!.family_id).toBe("22222222-2222-2222-2222-222222222222");
    expect(prod.calls[0]!.url).toBe("https://prod.example/api/ai/usage");
    const headers = prod.calls[0]!.init?.headers as Record<string, string>;
    expect(headers[AI_USAGE_HEADER]).toBe("s3cret");
    const body = JSON.parse(String(prod.calls[0]!.init?.body));
    expect(body.row.story_id).toBeUndefined();
    expect(body.row.family_id).toBeUndefined();
    expect(body.row.env).toBeUndefined();
    expect(body.source_ref).toBe("abcdef123");
    expect(remoteUsageSchema.safeParse(body).success).toBe(true);
  });

  it("сбой прода не роняет шаг: строка остаётся локально, бюджет — по локальной базе", async () => {
    const local = new MemoryStore();
    local.env = "staging";
    local.now = () => NOW;
    const prod = fakeProd();
    prod.setDown(true);
    const logs: string[] = [];
    const store = new SharedUsageStore(local, { prodUrl: "https://p", secret: "s", fetch: prod.fetchImpl, log: (m) => logs.push(m) });
    await expect(store.recordUsage(row({ cost_usd: 0.2 }))).resolves.toBeUndefined();
    expect(local.usage).toHaveLength(1);
    expect(await store.spend("openai", new Date("2026-11-27T00:00:00Z"))).toBeCloseTo(0.2);
    expect(logs.join(" ")).toMatch(/не отправлен/);
  });

  it("#218: бюджет — по своей базе, сводку прода не спрашивает", async () => {
    const local = new MemoryStore();
    local.env = "staging";
    local.now = () => NOW;
    const prod = fakeProd();
    const store = new SharedUsageStore(local, { prodUrl: "https://p", secret: "s", fetch: prod.fetchImpl });
    await store.recordUsage(row({ cost_usd: 0.1 }));
    await store.recordUsage(row({ cost_usd: 0.2 }));
    expect(await store.spend("openai", new Date("2026-11-27T00:00:00Z"))).toBeCloseTo(0.3);
    expect(prod.calls.every((c) => c.url === "https://p/api/ai/usage")).toBe(true);
    expect(prod.calls).toHaveLength(2);
  });

  it("квоты и остывание — локальные", async () => {
    const local = new MemoryStore();
    local.env = "staging";
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

});

describe("#218 прод не учитывает строки staging", () => {
  const since = new Date(NOW.getTime() - 60 * 60_000);

  function prodWithStagingRows() {
    const m = new MemoryStore(); // env не задан = прод
    m.now = () => NOW;
    return m;
  }

  it("таймаут / 429 на staging не «замораживает» модель в проде", async () => {
    const m = prodWithStagingRows();
    // так прод сохраняет строку, присланную превью (POST /api/ai/usage)
    await m.recordUsage(toProdRow(remoteUsageSchema.parse({ row: row({ provider: "gemini", model: "g", status: "timeout" }) }), NOW));
    await m.recordUsage(row({ provider: "gemini", model: "g", status: "rate_limited", env: "staging" }));
    expect(await m.hadFailureSince("gemini", "g", since)).toBe(false);
    await m.recordUsage(row({ provider: "gemini", model: "g", status: "timeout" }));
    expect(await m.hadFailureSince("gemini", "g", since)).toBe(true);
  });

  it("расход и вызовы staging не тратят бюджет и квоты прода; старые строки без env — прод", async () => {
    const m = prodWithStagingRows();
    await m.recordUsage(row({ cost_usd: 0.4, env: "staging" }));
    await m.recordUsage(row({ cost_usd: 0.1 }));
    await m.recordUsage(row({ cost_usd: 0.2, env: "prod" }));
    expect(await m.spend("openai", since)).toBeCloseTo(0.3);
    expect(await m.countCalls("openai", "gpt-5.4-mini", since)).toBe(2);
  });

  it("превью (своя база) считает все строки", async () => {
    const m = new MemoryStore();
    m.env = "staging";
    m.now = () => NOW;
    await m.recordUsage(row({ cost_usd: 0.4, env: "staging" }));
    await m.recordUsage(row({ cost_usd: 0.1 }));
    expect(await m.spend("openai", since)).toBeCloseTo(0.5);
  });

  it("isOwnUsage", () => {
    expect(isOwnUsage("staging", undefined)).toBe(false);
    expect(isOwnUsage("staging", "prod")).toBe(false);
    expect(isOwnUsage(null, undefined)).toBe(true);
    expect(isOwnUsage("prod", "prod")).toBe(true);
    expect(isOwnUsage("prod", "staging")).toBe(true);
  });
});

describe("#211 /admin/ai — расход по окружениям", () => {
  it("делит по env, строки без env — prod; #218: итог, бюджеты и остывание прода — без staging", () => {
    const rows = [
      { ...row({ cost_usd: 0.3 }), env: null },
      { ...row({ cost_usd: 0.2 }), env: "staging" },
      { ...row({ cost_usd: 0, provider: "gemini", model: "g", status: "timeout" }), env: "staging" },
    ].map((r) => ({ ...r, created_at: r.created_at! }));
    const routes = [{ step: "edit", providers: [{ provider: "gemini", model: "g" }] }] as unknown as Parameters<typeof summarize>[0]["routes"];
    const providers = [
      { provider: "gemini", enabled: true, paid: true, daily_budget_usd: 5, monthly_budget_usd: 10, cooldown_minutes: 10 },
    ] as Parameters<typeof summarize>[0]["providers"];
    const s = summarize({ rows, routes, providers, now: NOW });
    expect(s.scope).toBe("prod");
    expect(s.byEnv.find((e) => e.env === "prod")?.today).toBeCloseTo(0.3);
    expect(s.byEnv.find((e) => e.env === "staging")?.today).toBeCloseTo(0.2);
    expect(s.totals.today).toBeCloseTo(0.3);
    expect(s.cooling).toHaveLength(0);
    // На превью (своя база) — всё
    const stg = summarize({ rows, routes, providers, now: NOW, scope: "staging" });
    expect(stg.totals.today).toBeCloseTo(0.5);
    expect(stg.cooling).toHaveLength(1);
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
