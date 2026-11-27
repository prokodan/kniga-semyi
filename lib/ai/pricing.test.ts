import { describe, expect, it } from "vitest";
import { FALLBACK_PRICING, priceOf } from "./config";
import { outputTokens } from "./providers/gemini";
import { estimateCostUsd } from "./util";

describe("цены ИИ (#194)", () => {
  it("Gemini считается по своим ценам, а не по запасной", () => {
    expect(priceOf("gemini-3.5-flash-lite")).toEqual({ inPerM: 0.3, outPerM: 2.5 });
    expect(priceOf("неизвестная-модель")).toBe(FALLBACK_PRICING);
  });

  it("акция 3.6 Flash — по 31.12.2026, с 01.01.2027 — полная цена", () => {
    expect(priceOf("gemini-3.6-flash", new Date("2026-12-31T23:59:59Z"))).toEqual({ inPerM: 0.75, outPerM: 3.75 });
    expect(priceOf("gemini-3.6-flash", new Date("2027-01-01T00:00:00Z"))).toEqual({ inPerM: 1.5, outPerM: 7.5 });
  });

  it("стоимость вызова: 1M входа + 1M выхода Flash-Lite = $2.80; бесплатный провайдер — 0", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, audioSeconds: 60 };
    expect(estimateCostUsd("gemini-3.5-flash-lite", true, usage)).toBe(2.8);
    expect(estimateCostUsd("gemini-3.5-flash-lite", false, usage)).toBe(0);
  });

  it("выход Gemini = ответ + мысли", () => {
    expect(outputTokens({ usageMetadata: { candidatesTokenCount: 100, thoughtsTokenCount: 40 } })).toBe(140);
    expect(outputTokens({ usageMetadata: { candidatesTokenCount: 100 } })).toBe(100);
    expect(outputTokens({})).toBeUndefined();
  });
});
