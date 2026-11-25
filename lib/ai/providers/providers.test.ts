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

  it("Gemini 3.x: thinkingLevel low; если модель его не принимает — повтор без него", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test");
    const ok = { candidates: [{ content: { parts: [{ text: '{"text_ko":"가","title_ko":"나","quote_ko":"다"}' }] } }] };
    const fn = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "thinking_level is not supported" } }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(ok), { status: 200 }));
    vi.stubGlobal("fetch", fn);
    const res = await call(geminiProvider, "gemini-3.5-flash-lite");
    expect(res.output).toMatchObject({ text_ko: "가" });
    const bodies = fn.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)));
    expect(bodies[0].generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low" });
    expect(bodies[1].generationConfig.thinkingConfig).toBeUndefined();
  });

  it("Gemini 2.5: без thinkingConfig", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test");
    const fetchMock = stubFetch(200, { candidates: [{ content: { parts: [{ text: '{"text_ko":"가","title_ko":"나","quote_ko":"다"}' }] } }] });
    await call(geminiProvider, "gemini-2.5-flash");
    const body = JSON.parse(String(((fetchMock.mock.calls[0] as unknown[])[1] as RequestInit).body));
    expect(body.generationConfig.thinkingConfig).toBeUndefined();
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
    const res = await call(openaiProvider, "gpt-5.4-mini");
    expect(res.usage).toEqual({ inputTokens: 20, outputTokens: 7 });
  });

  it("картинки сказки (#94): quality low по умолчанию, OPENAI_IMAGE_QUALITY меняет", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test");
    const draw = () =>
      openaiProvider.call({ step: "illustrate", input: { prompt: "дом", style: "акварель" }, model: "gpt-image-2", systemPrompt: "", signal: new AbortController().signal });
    const bodyOf = (f: ReturnType<typeof stubFetch>) => JSON.parse(String(((f.mock.calls[0] as unknown[])[1] as RequestInit).body));
    let f = stubFetch(200, { data: [{ b64_json: "aGk=" }] });
    const res = await draw();
    expect(res.output).toEqual({ imageBase64: "aGk=", mimeType: "image/png" });
    expect(bodyOf(f)).toMatchObject({ model: "gpt-image-2", quality: "low", size: "1024x1024" });

    vi.stubEnv("OPENAI_IMAGE_QUALITY", "medium");
    f = stubFetch(200, { data: [{ b64_json: "aGk=" }] });
    await draw();
    expect(bodyOf(f).quality).toBe("medium");

    vi.stubEnv("OPENAI_IMAGE_QUALITY", "ultra"); // опечатка → безопасное low
    f = stubFetch(200, { data: [{ b64_json: "aGk=" }] });
    await draw();
    expect(bodyOf(f).quality).toBe("low");
  });

  it("500 → error", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test");
    stubFetch(500, { error: "boom" });
    await expect(call(openaiProvider, "gpt-5.4-mini")).rejects.toMatchObject({ kind: "error" });
  });
});

describe("gemini-3.5-transcribe (#52)", async () => {
  const { isTranscribeModel, transcribeModelBody, usesThinkingLevel } = await import("./gemini");
  it("без thinkingConfig, systemInstruction и JSON-режима: инструкция и аудио в user", () => {
    expect(isTranscribeModel("gemini-3.5-transcribe")).toBe(true);
    expect(usesThinkingLevel("gemini-3.5-transcribe")).toBe(false);
    expect(usesThinkingLevel("gemini-3.6-flash")).toBe(true);
    const body = transcribeModelBody({ mimeType: "audio/mp4;codecs=mp4a", audioBase64: "AAAA", hints: ["Уштобе", "Володя"] }) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["contents"]);
    const parts = (body.contents as { parts: Record<string, unknown>[] }[])[0]!.parts;
    expect(parts[0]!.text).toContain("Уштобе, Володя");
    expect(parts[1]).toEqual({ inline_data: { mime_type: "audio/mp4", data: "AAAA" } });
  });
});
