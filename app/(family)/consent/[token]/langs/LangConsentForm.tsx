"use client";
// #306: галочка «Согласен» под новым текстом согласия → PATCH /api/families/<токен>/langs { langs, agree: true }.
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LangConsentForm({ token, langs }: { token: string; langs: string }) {
  const router = useRouter();
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!agree || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/families/${encodeURIComponent(token)}/langs`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ langs, agree: true }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(data.message ?? "Не получилось сохранить. Попробуйте ещё раз.");
      router.push(`/f/${encodeURIComponent(token)}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Нет связи. Проверьте интернет и попробуйте ещё раз.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-card border border-line bg-paper px-4 py-3 text-lg text-ink has-[:checked]:border-ink">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="size-5 shrink-0 accent-seal" />
        <span>Согласен</span>
      </label>
      {error && <p className="rounded-card border border-danger/40 bg-paper p-4 text-danger">{error}</p>}
      <button
        type="button"
        onClick={() => void save()}
        disabled={!agree || busy}
        className="rounded-button bg-seal px-6 py-4 text-elder font-semibold text-paper active:bg-seal-dark disabled:opacity-60"
      >
        {busy ? "Сохраняем…" : "Сменить языки книги"}
      </button>
    </div>
  );
}
