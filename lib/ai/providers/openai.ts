// OpenAI — платный резерв с лимитом расходов. Ключ: OPENAI_API_KEY.
import { env } from "@/lib/env";
import { ProviderError, type AiProvider, type AiStep, type ProviderCall } from "../types";
import { parseJsonLoose } from "../util";
import { fetchJson } from "./http";

const BASE = "https://api.openai.com/v1";

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function auth(): string {
  const key = env.openaiApiKey();
  if (!key) throw new ProviderError("OPENAI_API_KEY не задан", "unsupported", "openai");
  return `Bearer ${key}`;
}

export const openaiProvider: AiProvider = {
  name: "openai",
  isConfigured: () => Boolean(env.openaiApiKey()),
  supports: () => true,

  async call<S extends AiStep>(req: ProviderCall<S>) {
    if (req.step === "transcribe") {
      const input = req.input as ProviderCall<"transcribe">["input"];
      const form = new FormData();
      const ext = input.mimeType.includes("mp4") ? "m4a" : input.mimeType.split("/")[1]?.split(";")[0] ?? "webm";
      form.append("file", new Blob([Buffer.from(input.audioBase64, "base64")], { type: input.mimeType }), `audio.${ext}`);
      form.append("model", req.model);
      form.append("response_format", "json");
      if (input.languageHint !== "mixed") form.append("language", input.languageHint);
      // prompt у моделей расшифровки — словарь: имена и места семьи пишутся так (≈ 200 токенов максимум)
      const vocab = (input.hints ?? []).slice(0, 45).join(", ");
      form.append("prompt", `Пожилой рассказчик вспоминает жизнь. Возможны слова на корё мар.${vocab ? ` Имена и места: ${vocab}.` : ""}`);
      const json = (await fetchJson("openai", `${BASE}/audio/transcriptions`, {
        method: "POST",
        headers: { authorization: auth() },
        body: form,
        signal: req.signal,
      })) as { text?: string };
      return { output: { text: json.text ?? "", language: input.languageHint }, usage: { audioSeconds: input.durationSec } };
    }

    if (req.step === "illustrate") {
      const input = req.input as ProviderCall<"illustrate">["input"];
      const json = (await fetchJson("openai", `${BASE}/images/generations`, {
        method: "POST",
        headers: { authorization: auth(), "content-type": "application/json" },
        body: JSON.stringify({ model: req.model, prompt: `${input.style}\n\n${input.prompt}`, size: "1024x1024", quality: env.openaiImageQuality(), n: 1 }),
        signal: req.signal,
      })) as { data?: { b64_json?: string }[] };
      const b64 = json.data?.[0]?.b64_json;
      if (!b64) throw new ProviderError("нет картинки в ответе", "bad_output", "openai");
      return { output: { imageBase64: b64, mimeType: "image/png" }, usage: { images: 1 } };
    }

    const json = (await fetchJson("openai", `${BASE}/chat/completions`, {
      method: "POST",
      headers: { authorization: auth(), "content-type": "application/json" },
      body: JSON.stringify({
        model: req.model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: req.systemPrompt },
          { role: "user", content: JSON.stringify(req.input) },
        ],
      }),
      signal: req.signal,
    })) as ChatResponse;

    const text = json.choices?.[0]?.message?.content ?? "";
    let output: unknown;
    try {
      output = parseJsonLoose(text);
    } catch {
      throw new ProviderError("ответ не JSON", "bad_output", "openai");
    }
    return {
      output,
      usage: { inputTokens: json.usage?.prompt_tokens, outputTokens: json.usage?.completion_tokens },
    };
  },
};
