import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PROVIDERS } from "@/lib/ai/config";
import { createRouter } from "@/lib/ai/router";
import { MemoryStore } from "@/lib/ai/store";
import type { AiProvider } from "@/lib/ai/types";
import { makeSessionToken, pinMatches, verifySessionToken } from "./pin";
import { AdminEditError, mergeProviders, mergeRoutes, moveEntry, parseRouteRow, parseThresholdPct, setEntryLimits } from "./routes";
import { MemorySource } from "./source";
import { nextResetInTz, summarize, type UsageLite } from "./stats";

// 22.11.2026 10:00 UTC = 02:00 по Лос-Анджелесу (PST, UTC−8)
const NOW = new Date("2026-11-22T10:00:00Z");

const row = (p: Partial<UsageLite>): UsageLite => ({
  step: "edit",
  provider: "gemini",
  model: "m-lite",
  status: "ok",
  cost_usd: 0,
  created_at: NOW.toISOString(),
  ...p,
});

// ID моделей — произвольные: админка не должна от них зависеть.
const routes = mergeRoutes([
  {
    step: "edit",
    providers: [
      { provider: "gemini", model: "m-lite", daily_limit: 100, threshold: 0.9 },
      { provider: "openai", model: "o-paid" },
    ],
    pinned_provider: null,
    timeout_ms: 1000,
    enabled: true,
  },
  { step: "translate", providers: [{ provider: "gemini", model: "m-lite", daily_limit: 50, threshold: 0.8 }], timeout_ms: 1000 },
]);
const providers = mergeProviders([], routes);

describe("summarize", () => {
  it("считает квоту по суткам Тихоокеанского времени, а не UTC", () => {
    const rows = [
      row({ created_at: "2026-11-22T08:30:00Z" }), // 00:30 PST — сегодня
      row({ created_at: "2026-11-22T07:30:00Z" }), // 23:30 PST вчера — не в сегодняшней квоте
      row({ status: "error", created_at: "2026-11-22T09:00:00Z" }),
      row({ status: "cache_hit", provider: "cache", model: "cache" }),
    ];
    const s = summarize({ rows, routes, providers, now: NOW });
    const q = s.quotas.find((x) => x.model === "m-lite")!;
    expect(q.used).toBe(2);
    // самый строгий порог среди шагов: 50 × 0.8 = 40
    expect(q.limit).toBe(50);
    expect(q.cap).toBe(40);
    expect(q.steps.sort()).toEqual(["edit", "translate"]);
    expect(q.timeZone).toBe("America/Los_Angeles");
    expect(q.resetsAt).toBe("2026-11-23T08:00:00.000Z");
  });

  it("помечает модель за порогом и показывает модели без квоты отдельно", () => {
    const rows = Array.from({ length: 40 }, () => row({}));
    const s = summarize({ rows, routes, providers, now: NOW });
    expect(s.quotas[0]!.state).toBe("over");
    expect(s.unlimited.map((u) => u.model)).toContain("o-paid");
    expect(s.unlimited.map((u) => u.model)).not.toContain("m-lite");
  });

  it("складывает расход за день и месяц и проценты бюджета", () => {
    const rows = [
      row({ provider: "openai", model: "o-paid", cost_usd: "0.5", created_at: "2026-11-22T01:00:00Z" }),
      row({ provider: "openai", model: "o-paid", cost_usd: 1.5, created_at: "2026-11-03T01:00:00Z" }),
      row({ provider: "openai", model: "o-paid", cost_usd: 9, created_at: "2026-10-31T23:00:00Z" }), // прошлый месяц
    ];
    const s = summarize({ rows, routes, providers, now: NOW });
    const o = s.spend.find((x) => x.provider === "openai")!;
    expect(o.today).toBe(0.5);
    expect(o.month).toBe(2);
    expect(o.todayPct).toBeCloseTo(0.5 / DEFAULT_PROVIDERS.openai.daily_budget_usd!);
    expect(o.monthPct).toBeCloseTo(2 / DEFAULT_PROVIDERS.openai.monthly_budget_usd!);
    expect(o.forecastMonth).toBeGreaterThan(2);
    expect(s.totals.month).toBe(2);
  });

  it("доля кэша и остывание после 429", () => {
    const rows = [
      row({}),
      row({ status: "cache_hit", provider: "cache", model: "cache" }),
      row({ status: "rate_limited", created_at: "2026-11-22T09:55:00Z" }),
      row({ status: "timeout", model: "o-paid", provider: "openai", created_at: "2026-11-22T09:00:00Z" }), // давно
    ];
    const s = summarize({ rows, routes, providers, now: NOW });
    expect(s.cache.today).toEqual({ hits: 1, calls: 1, share: 0.5 });
    expect(s.cooling).toHaveLength(1);
    expect(s.cooling[0]).toMatchObject({ model: "m-lite", until: "2026-11-22T10:05:00.000Z" });
  });

  it("следующий сброс квоты учитывает переход на летнее время", () => {
    expect(nextResetInTz("America/Los_Angeles", new Date("2026-03-08T06:00:00Z")).toISOString()).toBe("2026-03-08T08:00:00.000Z");
    expect(nextResetInTz("UTC", NOW).toISOString()).toBe("2026-11-23T00:00:00.000Z");
  });
});

describe("правки маршрутов", () => {
  const entries = routes[0]!.providers.length ? routes.find((r) => r.step === "edit")!.providers : [];

  it("меняет порядок и квоту, не теряя записей", () => {
    const moved = moveEntry(entries, { index: 1, provider: "openai", model: "o-paid" }, "up");
    expect(moved.map((e) => e.model)).toEqual(["o-paid", "m-lite"]);
    const limited = setEntryLimits(entries, { index: 0, provider: "gemini", model: "m-lite" }, { daily_limit: null, threshold: 0.5 });
    expect(limited[0]).toEqual({ provider: "gemini", model: "m-lite", threshold: 0.5 });
  });

  it("отклоняет правку, если модели в таблице поменялись (workflow ai-models)", () => {
    expect(() => moveEntry(entries, { index: 0, provider: "gemini", model: "старая-модель" }, "down")).toThrow(AdminEditError);
  });

  it("порог из процентов и проверка диапазона", () => {
    expect(parseThresholdPct("85")).toBe(0.85);
    expect(parseThresholdPct("")).toBeNull();
    expect(() => parseThresholdPct("150")).toThrow(AdminEditError);
  });

  it("строка без моделей не ломает разбор, null-поля убираются", () => {
    const r = parseRouteRow("edit", { step: "edit", providers: [{ provider: "gemini", model: "x", daily_limit: null }, { bad: 1 }] });
    expect(r.providers).toEqual([{ provider: "gemini", model: "x" }]);
    expect(parseRouteRow("tale", null).source).toBe("default");
  });
});

describe("PIN и cookie", () => {
  it("подписанная cookie живёт 12 часов и зависит от PIN", () => {
    const token = makeSessionToken("4321", NOW);
    expect(verifySessionToken("4321", token, NOW)).toBe(true);
    expect(verifySessionToken("1111", token, NOW)).toBe(false);
    expect(verifySessionToken("4321", token, new Date(NOW.getTime() + 13 * 3_600_000))).toBe(false);
    expect(verifySessionToken("4321", "123.подделка", NOW)).toBe(false);
    expect(verifySessionToken(undefined, token, NOW)).toBe(false);
    expect(pinMatches("4321", " 4321 ")).toBe(true);
    expect(pinMatches(undefined, "")).toBe(false);
  });
});

describe("изменения применяются со следующего вызова", () => {
  const out = { text_ko: "안녕", title_ko: "시작", quote_ko: "안녕" };
  const fake = (name: "gemini" | "openai"): AiProvider => ({
    name,
    isConfigured: () => true,
    supports: () => true,
    call: vi.fn(async () => ({ output: out, usage: { inputTokens: 10, outputTokens: 10 } })),
  });
  const input = { text_ru: "Текст", title: "Т", quote: "Ц" };

  it("выключение провайдера и закрепление шага видит роутер без перезапуска", async () => {
    const store = new MemoryStore();
    const router = createRouter({
      store,
      providers: { gemini: fake("gemini"), openai: fake("openai") },
      mode: () => "auto",
      loadPrompt: async () => ({ text: "p", version: "v" }),
    });
    const admin = new MemorySource(store);

    expect((await router.runWithMeta("translate", input, { noCache: true })).provider).toBe("gemini");

    await admin.saveProvider("gemini", { enabled: false });
    expect((await router.runWithMeta("translate", input, { noCache: true })).provider).toBe("openai");

    await admin.saveProvider("gemini", { enabled: true });
    await admin.saveRoute("translate", { pinned_provider: "openai" });
    expect((await router.runWithMeta("translate", input, { noCache: true })).provider).toBe("openai");

    const view = await admin.getRoute("translate");
    expect(view.pinned_provider).toBe("openai");
    expect((await admin.usageSince(new Date(0))).length).toBe(3);
  });
});
