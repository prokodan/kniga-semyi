// Классы киоска: крупно, кнопки ≥ 64 px (min-h-16), только токены из app/globals.css.
export const kBtn = "inline-flex min-h-16 items-center justify-center gap-3 rounded-button px-8 text-elder font-semibold disabled:opacity-60";
export const kPrimary = `${kBtn} bg-seal text-paper active:bg-seal-dark`;
export const kDark = `${kBtn} bg-ink text-paper`;
export const kGhost = `${kBtn} border border-line bg-paper text-ink-soft active:bg-paper-deep`;
export const kField =
  "min-h-16 w-full rounded-card border border-line bg-paper px-5 text-elder text-ink placeholder:text-muted focus:border-ink focus:outline-none";
export const kLabel = "flex flex-col gap-2 text-ink-soft";
/** Обёртка вокруг общего Recorder (I1): его кнопки на киоске тоже ≥ 64 px и крупным шрифтом. */
export const kRecorderWrap = "[&_button]:min-h-16 [&_button]:text-elder";

export async function kioskPost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(data.message ?? "Не получилось. Попробуйте ещё раз.");
  return data;
}
