import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ROUTES } from "./config";
import { createRouter } from "./router";
import { MemoryStore } from "./store";
import { AiUnavailableError, ProviderError, type AiProvider, type AiStep } from "./types";

const translateInput = { text_ru: "Я родился в Уштобе.", title: "Начало", quote: "Я родился" };
const okOutput = { text_ko: "나는 우슈토베에서 태어났다.", title_ko: "시작", quote_ko: "나는 태어났다" };
const prompt = async () => ({ text: "prompt", version: "v1" });

function fakeProvider(name: "gemini" | "openai", impl: (model: string) => unknown | Promise<unknown>): AiProvider {
  return {
    name,
    isConfigured: () => true,
    supports: (s: AiStep) => s !== "illustrate" || name === "openai",
    call: vi.fn(async ({ model }) => ({ output: await impl(model), usage: { inputTokens: 1000, outputTokens: 500 } })),
  };
}

function setup(opts: { gemini?: AiProvider; openai?: AiProvider; mode?: "auto" | "mock" | "gemini" | "openai" } = {}) {
  const store = new MemoryStore();
  const gemini = opts.gemini ?? fakeProvider("gemini", () => okOutput);
  const openai = opts.openai ?? fakeProvider("openai", () => okOutput);
  const router = createRouter({
    store,
    providers: { gemini, openai },
    mode: () => opts.mode ?? "auto",
    loadPrompt: prompt,
  });
  return { store, router, gemini, openai };
}

describe("ai router", () => {
  it("в режиме mock отвечает заглушкой и не трогает провайдеров и кэш", async () => {
    const { router, gemini, store } = setup({ mode: "mock" });
    const res = await router.runWithMeta("translate", translateInput);
    expect(res.provider).toBe("mock");
    expect(res.output.text_ko.length).toBeGreaterThan(0);
    expect(gemini.call).not.toHaveBeenCalled();
    expect(store.cache.size).toBe(0);
  });

  it("берёт первого провайдера из маршрута (бесплатный Flash-Lite)", async () => {
    const { router } = setup();
    const res = await router.runWithMeta("translate", translateInput);
    expect(res.provider).toBe("gemini");
    expect(res.model).toBe(DEFAULT_ROUTES.translate.providers[0]!.model);
  });

  it("при 429 переходит к следующему и ставит модель на остывание", async () => {
    const gemini = fakeProvider("gemini", (model) => {
      if (model === "gemini-2.5-flash-lite") throw new ProviderError("429", "rate_limited", "gemini");
      return okOutput;
    });
    const { router, store } = setup({ gemini });
    const first = await router.runWithMeta("translate", translateInput);
    expect(first.model).toBe("gemini-2.5-flash");
    expect(store.usage.some((u) => u.status === "rate_limited")).toBe(true);

    // второй вызов: Flash-Lite остывает, даже не вызывается
    const callsBefore = (gemini.call as ReturnType<typeof vi.fn>).mock.calls.length;
    await router.runWithMeta("translate", { ...translateInput, text_ru: "Другой текст" });
    const models = (gemini.call as ReturnType<typeof vi.fn>).mock.calls.slice(callsBefore).map((c) => c[0].model);
    expect(models).toEqual(["gemini-2.5-flash"]);
  });

  it("переходит к следующему при пороге квоты (90% от daily_limit)", async () => {
    const { router, store } = setup();
    for (let i = 0; i < 450; i++) {
      await store.recordUsage({ step: "edit", provider: "gemini", model: "gemini-2.5-flash-lite", status: "ok", cost_usd: 0 });
    }
    const res = await router.runWithMeta("translate", translateInput);
    expect(res.model).toBe("gemini-2.5-flash");
    expect(res.attempts[0]?.reason).toContain("квота 450/500");
  });

  it("при таймауте переходит к платному OpenAI и считает стоимость", async () => {
    const gemini = fakeProvider("gemini", () => {
      throw new ProviderError("timeout", "timeout", "gemini");
    });
    const { router, store } = setup({ gemini });
    const res = await router.runWithMeta("translate", translateInput);
    expect(res.provider).toBe("openai");
    const paid = store.usage.find((u) => u.provider === "openai" && u.status === "ok");
    expect(paid?.cost_usd).toBeGreaterThan(0);
  });

  it("не вызывает платного провайдера при исчерпанном бюджете дня", async () => {
    const gemini = fakeProvider("gemini", () => {
      throw new ProviderError("429", "rate_limited", "gemini");
    });
    const { router, store, openai } = setup({ gemini });
    await store.recordUsage({ step: "edit", provider: "openai", model: "gpt-5-mini", status: "ok", cost_usd: 2.5 });
    await expect(router.run("translate", translateInput)).rejects.toBeInstanceOf(AiUnavailableError);
    expect(openai.call).not.toHaveBeenCalled();
  });

  it("неверный JSON от модели = ошибка провайдера, идём дальше", async () => {
    const gemini = fakeProvider("gemini", () => ({ wrong: true }));
    const { router } = setup({ gemini });
    const res = await router.runWithMeta("translate", translateInput);
    expect(res.provider).toBe("openai");
  });

  it("второй одинаковый вызов берётся из кэша без обращения к модели", async () => {
    const { router, gemini, store } = setup();
    await router.run("translate", translateInput);
    const again = await router.runWithMeta("translate", translateInput);
    expect(again.cached).toBe(true);
    expect(gemini.call).toHaveBeenCalledTimes(1);
    expect(store.usage.at(-1)?.status).toBe("cache_hit");
  });

  it("закреплённый провайдер и выключение провайдера из админки", async () => {
    const { router, store } = setup();
    store.routes.translate = { ...DEFAULT_ROUTES.translate, pinned_provider: "openai" };
    expect((await router.runWithMeta("translate", translateInput)).provider).toBe("openai");

    store.routes.translate = DEFAULT_ROUTES.translate;
    store.providers.gemini = { provider: "gemini", enabled: false, paid: false, daily_budget_usd: null, monthly_budget_usd: null, cooldown_minutes: 10 };
    const res = await router.runWithMeta("translate", { ...translateInput, quote: "x" });
    expect(res.provider).toBe("openai");
  });

  it("неверный вход отклоняется до вызова модели", async () => {
    const { router, gemini } = setup();
    // @ts-expect-error — проверяем рантайм-валидацию
    await expect(router.run("translate", { title: "x" })).rejects.toThrow();
    expect(gemini.call).not.toHaveBeenCalled();
  });
});
