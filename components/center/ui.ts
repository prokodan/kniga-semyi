// Классы кабинета АКНЦ: мобильный в первую очередь, кнопки ≥ 48 px, только токены из app/globals.css.
export { btnCls, btnGhostCls, inputCls } from "@/components/admin/ui";

export async function centerSend<T>(url: string, method: "POST" | "PATCH", body: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(data.message ?? "Не получилось. Попробуйте ещё раз.");
  return data;
}

/** Ссылка с сохранением фильтра демо-семей. */
export function centerHref(path: string, hideDemo: boolean, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams(extra);
  if (hideDemo) q.set("demo", "hide");
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
