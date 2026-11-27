import { describe, expect, it } from "vitest";
import { parseBudgets, planStagingConfig, reportMarkdown } from "./ai-config-sync.mjs";

const ROUTE = {
  step: "edit",
  providers: [
    { provider: "gemini", model: "gemini-3.6-flash" },
    { provider: "openai", model: "gpt-5.4-mini" },
  ],
  pinned_provider: null,
  timeout_ms: 30_000,
  enabled: true,
};
const PROD = [
  { provider: "gemini", enabled: true, paid: true, daily_budget_usd: 5, monthly_budget_usd: 10, cooldown_minutes: 10 },
  { provider: "openai", enabled: true, paid: true, daily_budget_usd: 2, monthly_budget_usd: 5, cooldown_minutes: 10 },
];
// staging как до ручной правки 27.11: Gemini бесплатный, свой бюджет
const STG = [{ provider: "gemini", enabled: true, paid: false, daily_budget_usd: 1, monthly_budget_usd: 3, cooldown_minutes: 5 }];

describe("#222 ai-config-sync: настройки ИИ staging = прод", () => {
  it("маршруты копируются целиком; paid / enabled / cooldown — из прода (#244)", () => {
    const plan = planStagingConfig({ prodRoutes: [ROUTE], prodProviders: PROD, stagingProviders: STG });
    expect(plan.routes).toEqual([ROUTE]);
    const gemini = plan.providers.find((p) => p.provider === "gemini")!;
    expect(gemini).toMatchObject({ paid: true, enabled: true, cooldown_minutes: 10 });
  });

  it("бюджет: без входа — свой у staging, нет строки в staging — как в проде", () => {
    const plan = planStagingConfig({ prodRoutes: [ROUTE], prodProviders: PROD, stagingProviders: STG });
    expect(plan.providers.find((p) => p.provider === "gemini")).toMatchObject({ daily_budget_usd: 1, monthly_budget_usd: 3 });
    expect(plan.providers.find((p) => p.provider === "openai")).toMatchObject({ daily_budget_usd: 2, monthly_budget_usd: 5 });
  });

  it("бюджет: из входа / переменной и «same» = как в проде", () => {
    const own = planStagingConfig({
      prodRoutes: [ROUTE],
      prodProviders: PROD,
      stagingProviders: STG,
      budgets: parseBudgets("gemini=3/6, openai=1/-"),
    });
    expect(own.providers.find((p) => p.provider === "gemini")).toMatchObject({ daily_budget_usd: 3, monthly_budget_usd: 6 });
    expect(own.providers.find((p) => p.provider === "openai")).toMatchObject({ daily_budget_usd: 1, monthly_budget_usd: null });
    const same = planStagingConfig({ prodRoutes: [ROUTE], prodProviders: PROD, stagingProviders: STG, budgets: "same" });
    expect(same.providers.find((p) => p.provider === "gemini")).toMatchObject({ daily_budget_usd: 5, monthly_budget_usd: 10 });
  });

  it("пустой прод — ошибка, staging не трогаем; лишние шаги staging — только в отчёте", () => {
    expect(() => planStagingConfig({ prodRoutes: [], prodProviders: PROD, stagingProviders: STG })).toThrow(/нет ai_routes/);
    const plan = planStagingConfig({ prodRoutes: [ROUTE], prodProviders: PROD, stagingProviders: STG, stagingSteps: ["edit", "old"] });
    expect(plan.extraSteps).toEqual(["old"]);
    expect(reportMarkdown(plan)).toContain("gemini:gemini-3.6-flash → openai:gpt-5.4-mini");
  });

  it("разбор STAGING_AI_BUDGETS", () => {
    expect(parseBudgets("")).toBeNull();
    expect(parseBudgets(undefined)).toBeNull();
    expect(parseBudgets("SAME")).toBe("same");
    expect(parseBudgets("gemini=5/10")).toEqual({ gemini: { daily: 5, monthly: 10 } });
    expect(() => parseBudgets("gemini=пять")).toThrow(/не понял/);
  });
});
