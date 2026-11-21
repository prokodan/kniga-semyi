import { afterEach, describe, expect, it, vi } from "vitest";
import { geminiProvider } from "./gemini";
import { openaiProvider } from "./openai";

const input = { text_ru: "Я родился в Уштобе.", title: "Начало", quote: "Я родился" };
const call = (p: typeof geminiProvider, model: string) =>
  p.call({ step: "translate", input, model, systemPrompt: "sys", signal: new AbortController().signal });

function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("gemini provider", () => {
  it("разбирает JSON-ответ и токены", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test");
    const fetchMock = stubFetch(200, {
      candidates: [{ content: { parts: [{ text: '```json\n{"text_ko":"가","title_ko":"나","quote_ko":"다"}\n```' }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    });
    const res = await call(geminiProvider, "gemini-2.5-flash-lite");
    expect(res.output).toEqual({ text_ko: "가", title_ko: "나", quote_ko: "다" });
    expect(res.usage).toMatchObject({ inputTokens: 10, outputTokens: 5 });
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("gemini-2.5-flash-lite:generateContent");
  });

  it("429 → rate_limited", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test");
    stubFetch(429, { error: { message: "quota" } });
    await expect(call(geminiProvider, "m")).rejects.toMatchObject({ kind: "rate_limited" });
  });
});

describe("openai provider", () => {
  it("разбирает chat completions", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test");
    stubFetch(200, {
      choices: [{ message: { content: '{"text_ko":"가","title_ko":"나","quote_ko":"다"}' } }],
      usage: { prompt_tokens: 20, completion_tokens: 7 },
    });
    const res = await call(openaiProvider, "gpt-5-mini");
    expect(res.usage).toEqual({ inputTokens: 20, outputTokens: 7 });
  });

  it("500 → error", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test");
    stubFetch(500, { error: "boom" });
    await expect(call(openaiProvider, "gpt-5-mini")).rejects.toMatchObject({ kind: "error" });
  });
});
