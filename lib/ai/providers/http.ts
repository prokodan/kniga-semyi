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
    // 503 «перегружено» у Gemini ведёт себя как временный лимит
    const kind = res.status === 503 ? "rate_limited" : "error";
    throw new ProviderError(`HTTP ${res.status}: ${body.slice(0, 300)}`, kind, provider);
  }
  return res.json();
}
