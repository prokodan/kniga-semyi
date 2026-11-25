import { describe, expect, it } from "vitest";
import { STEP_LEASE_MS } from "./engine";
import { needsHeal } from "./heal-rule";

// #166: какие истории семья подталкивает ответом интервью / открытием страницы
const now = Date.parse("2026-11-25T16:30:00Z");
const ago = (s: number) => new Date(now - s * 1000).toISOString();

describe("needsHeal", () => {
  it("стоит на edit 20 мин без аренды → подтолкнуть", () => {
    expect(needsHeal({ id: "a", status: "editing", updated_at: ago(1200), step_started_at: null }, now, STEP_LEASE_MS)).toBe(true);
  });
  it("аренда истекла (функцию убили) → подтолкнуть", () => {
    expect(needsHeal({ id: "a", status: "translating", updated_at: ago(600), step_started_at: ago(600) }, now, STEP_LEASE_MS)).toBe(true);
  });
  it("шаг идёт прямо сейчас → не трогать", () => {
    expect(needsHeal({ id: "a", status: "editing", updated_at: ago(200), step_started_at: ago(20) }, now, STEP_LEASE_MS)).toBe(false);
  });
  it("обновлялась только что → не трогать", () => {
    expect(needsHeal({ id: "a", status: "transcribing", updated_at: ago(30), step_started_at: null }, now, STEP_LEASE_MS)).toBe(false);
  });
  it("готовая, failed, skipped → не трогать", () => {
    for (const status of ["ready", "failed", "skipped"] as const) {
      expect(needsHeal({ id: "a", status, updated_at: ago(3600), step_started_at: null }, now, STEP_LEASE_MS)).toBe(false);
    }
  });
});
