import { describe, expect, it } from "vitest";
import { aiConfigFingerprint, routesMatch, stableJson } from "./config-fingerprint";

const ROUTES = [
  { step: "edit", providers: [{ provider: "gemini", model: "gemini-3.6-flash" }, { provider: "openai", model: "gpt-5.4-mini" }], pinned_provider: null, timeout_ms: 30_000, enabled: true },
  { step: "transcribe", providers: [{ provider: "openai", model: "gpt-4o-transcribe" }], pinned_provider: null, timeout_ms: 45_000, enabled: true },
];
const PROVIDERS = [
  { provider: "gemini", enabled: true, paid: true, cooldown_minutes: 10, daily_budget_usd: 5, monthly_budget_usd: 10 },
  { provider: "openai", enabled: true, paid: true, cooldown_minutes: 10, daily_budget_usd: 2, monthly_budget_usd: 5 },
];

describe("#222 отпечаток настроек ИИ (прод vs staging)", () => {
  it("не зависит от порядка строк и ключей; бюджеты не входят", () => {
    const a = aiConfigFingerprint(ROUTES, PROVIDERS);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    const shuffled = [...ROUTES].reverse().map((r) => ({ enabled: r.enabled, timeout_ms: r.timeout_ms, providers: r.providers.map((e) => ({ model: e.model, provider: e.provider })), step: r.step, pinned_provider: r.pinned_provider }));
    const otherBudgets = PROVIDERS.map((p) => ({ ...p, daily_budget_usd: 1, monthly_budget_usd: 2 })).reverse();
    expect(aiConfigFingerprint(shuffled, otherBudgets)).toBe(a);
  });

  it("порядок моделей, таймаут, закрепление и paid — меняют отпечаток", () => {
    const a = aiConfigFingerprint(ROUTES, PROVIDERS);
    const swapped = [{ ...ROUTES[0]!, providers: [...ROUTES[0]!.providers].reverse() }, ROUTES[1]!];
    expect(aiConfigFingerprint(swapped, PROVIDERS)).not.toBe(a);
    expect(aiConfigFingerprint([{ ...ROUTES[0]!, timeout_ms: 1 }, ROUTES[1]!], PROVIDERS)).not.toBe(a);
    expect(aiConfigFingerprint([{ ...ROUTES[0]!, pinned_provider: "openai" }, ROUTES[1]!], PROVIDERS)).not.toBe(a);
    expect(aiConfigFingerprint(ROUTES, [{ ...PROVIDERS[0]!, paid: false }, PROVIDERS[1]!])).not.toBe(a);
  });

  it("сравнение: нет одного из отпечатков → null", () => {
    expect(routesMatch("abc", "abc")).toBe(true);
    expect(routesMatch("abc", "abd")).toBe(false);
    expect(routesMatch(null, "abc")).toBeNull();
    expect(routesMatch("abc", undefined)).toBeNull();
    expect(stableJson({ b: 1, a: [{ d: 2, c: undefined }] })).toBe('{"a":[{"d":2}],"b":1}');
  });
});
