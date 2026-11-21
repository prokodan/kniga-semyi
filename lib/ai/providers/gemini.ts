// Google Gemini (AI Studio, бесплатная квота). Ключ: GEMINI_API_KEY.
// Текст и аудио — generateContent с responseMimeType=application/json.
import { env } from "@/lib/env";
import { ProviderError, type AiProvider, type AiStep, type ProviderCall } from "../types";
import { parseJsonLoose } from "../util";
import { fetchJson } from "./http";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  promptFeedback?: { blockReason?: string };
}

/** Gemini 3.x думают по умолчанию долго; для расшифровки и редактуры хватает низкого уровня — быстрее и в лимит 60 с. */
export function usesThinkingLevel(model: string): boolean {
  return /^gemini-[3-9]/.test(model);
}

export function generationConfig(model: string, thinking = true): Record<string, unknown> {
  const cfg: Record<string, unknown> = { responseMimeType: "application/json", temperature: 0.4 };
  if (thinking && usesThinkingLevel(model)) cfg.thinkingConfig = { thinkingLevel: "low" };
  return cfg;
}

export const geminiProvider: AiProvider = {
  name: "gemini",
  isConfigured: () => Boolean(env.geminiApiKey()),
  supports: (step: AiStep) => step !== "illustrate",

  async call<S extends AiStep>(req: ProviderCall<S>) {
    const key = env.geminiApiKey();
    if (!key) throw new ProviderError("GEMINI_API_KEY не задан", "unsupported", "gemini");

    const parts: Record<string, unknown>[] = [];
    if (req.step === "transcribe") {
      const input = req.input as ProviderCall<"transcribe">["input"];
      parts.push({ inline_data: { mime_type: input.mimeType.split(";")[0]!.trim(), data: input.audioBase64 } });
      parts.push({ text: JSON.stringify({ languageHint: input.languageHint, durationSec: input.durationSec }) });
    } else {
      parts.push({ text: JSON.stringify(req.input) });
    }

    const url = `${BASE}/${encodeURIComponent(req.model)}:generateContent`;
    const send = (thinking: boolean) =>
      fetchJson("gemini", url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.systemPrompt }] },
          contents: [{ role: "user", parts }],
          generationConfig: generationConfig(req.model, thinking),
        }),
        signal: req.signal,
      });
    let json: GeminiResponse;
    try {
      json = (await send(true)) as GeminiResponse;
    } catch (e) {
      // Модель не приняла thinkingConfig (HTTP 400 про thinking) — повторяем один раз без него.
      if (!usesThinkingLevel(req.model) || !(e instanceof ProviderError) || !/HTTP 400.*thinking/is.test(e.message)) throw e;
      json = (await send(false)) as GeminiResponse;
    }

    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text) {
      const reason = json.promptFeedback?.blockReason ?? json.candidates?.[0]?.finishReason ?? "empty";
      throw new ProviderError(`пустой ответ (${reason})`, "bad_output", "gemini");
    }
    let output: unknown;
    try {
      output = parseJsonLoose(text);
    } catch {
      throw new ProviderError("ответ не JSON", "bad_output", "gemini");
    }
    return {
      output,
      usage: {
        inputTokens: json.usageMetadata?.promptTokenCount,
        outputTokens: json.usageMetadata?.candidatesTokenCount,
        audioSeconds:
          req.step === "transcribe" ? (req.input as ProviderCall<"transcribe">["input"]).durationSec : undefined,
      },
    };
  },
};
