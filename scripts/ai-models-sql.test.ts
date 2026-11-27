import { describe, expect, it } from "vitest";
import { routesSql, withoutGeminiQuotas } from "./ai-models-sql.mjs";

const FL = { provider: "gemini", model: "gemini-3.5-flash-lite", daily_limit: 500, threshold: 0.9 };
const GPT = { provider: "openai", model: "gpt-5.4-mini" };

describe("ai-models: SQL для ai_routes (#194)", () => {
  it("у платного Gemini квоты не пишутся, у OpenAI ничего не меняется", () => {
    expect(withoutGeminiQuotas([FL, GPT])).toEqual([{ provider: "gemini", model: "gemini-3.5-flash-lite" }, GPT]);
  });

  it("выбор между вариантами делает база по ai_providers.gemini.paid", () => {
    const sql = routesSql({ edit: [FL, GPT] }, { edit: 30_000 });
    expect(sql).toContain("case when coalesce((select paid from ai_providers where provider = 'gemini'), false)");
    expect(sql).toContain(`then '${JSON.stringify(withoutGeminiQuotas([FL, GPT]))}'::jsonb`);
    expect(sql).toContain(`else '${JSON.stringify([FL, GPT])}'::jsonb end, 30000)`);
    expect(sql).toMatch(/^begin;$/m);
    expect(sql).toMatch(/^commit;$/m);
  });

  it("кавычки в JSON экранируются", () => {
    const sql = routesSql({ edit: [{ provider: "gemini", model: "a'b" }] }, { edit: 1 });
    expect(sql).toContain("a''b");
  });
});
