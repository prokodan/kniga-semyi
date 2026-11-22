import { ProviderError, type AiProviderName } from "../types";

/** fetch с переводом HTTP-ошибок в ProviderError нужного вида. */
export async function fetchJson(
  provider: AiProviderName,
  url: string,
  init: RequestInit & { signal: AbortSignal },
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    if (init.signal.aborted) throw new ProviderError("timeout", "timeout", provider);
    throw new ProviderError(`network: ${(e as Error).message}`, "error", provider);
  }
  if (res.status === 429) throw new ProviderError("429 rate limited", "rate_limited", provider);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // 503 «high demand» у Gemini — разовая перегрузка, не квота: без 10-минутного «остывания» модели
    // (иначе после одного 503 весь трафик уходил на медленные Flash / gpt-5-mini и упирался в таймауты).
    const kind = "error";
    throw new ProviderError(`HTTP ${res.status}: ${body.slice(0, 300)}`, kind, provider);
  }
  return res.json();
}
