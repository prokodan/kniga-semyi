// #353: проверка тела запроса страницы проверяющего 2.0 — как #232 (parseFeedback) + оценки фокус-слов.
import { FeedbackError, LIMITS, parseFeedback } from "@/app/admin/reviews/_lib/core";
import { TERMS_MAX, type TermVerdicts } from "./core";
import type { CheckFeedbackInput } from "./repo";

export { FeedbackError };

export const FIX_MAX = 200;

export function parseCheckFeedback(body: unknown): CheckFeedbackInput {
  const base = parseFeedback(body);
  const raw = (body as Record<string, unknown>).terms;
  if (raw === undefined || raw === null) return { ...base, terms: null };
  if (typeof raw !== "object" || Array.isArray(raw)) throw new FeedbackError("terms");
  if (base.paragraph !== -1) throw new FeedbackError("слова — только на весь текст (paragraph = -1)");
  const terms: TermVerdicts = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(k);
    if (!/^\d+$/.test(k) || n >= TERMS_MAX) throw new FeedbackError(`terms.${k}`);
    if (!v || typeof v !== "object") throw new FeedbackError(`terms.${k}`);
    const { ok, fix } = v as { ok?: unknown; fix?: unknown };
    if (ok !== true && ok !== false && ok !== null && ok !== undefined) throw new FeedbackError(`terms.${k}.ok`);
    const verdict: boolean | null = ok === true ? true : ok === false ? false : null;
    if (fix !== undefined && fix !== null && typeof fix !== "string") throw new FeedbackError(`terms.${k}.fix`);
    const f = typeof fix === "string" ? fix.replace(/\s+/g, " ").trim() : "";
    if (f.length > FIX_MAX) throw new FeedbackError(`terms.${k}.fix: длиннее ${FIX_MAX} символов`);
    terms[k] = { ok: verdict, fix: verdict === false && f ? f : null };
  }
  return { ...base, terms };
}

export { LIMITS };
