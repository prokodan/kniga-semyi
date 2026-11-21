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
      parts.push({ inline_data: { mime_type: input.mimeType, data: input.audioBase64 } });
      parts.push({ text: JSON.stringify({ languageHint: input.languageHint, durationSec: input.durationSec }) });
    } else {
      parts.push({ text: JSON.stringify(req.input) });
    }

    const json = (await fetchJson("gemini", `${BASE}/${encodeURIComponent(req.model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.systemPrompt }] },
        contents: [{ role: "user", parts }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
      }),
      signal: req.signal,
    })) as GeminiResponse;

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
