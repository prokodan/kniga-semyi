"use client";
// #306: галочка «Согласен» + «Оплатить (демо)» → POST /api/families/<токен>/langs/add { lang, agree: true }.
import Link from "next/link";
import { useState } from "react";

export function AddLangForm({ token, lang, name, price }: { token: string; lang: string; name: string; price: string }) {
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ queued: number } | null>(null);
  const enc = encodeURIComponent(token);

  async function pay() {
    if (!agree || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/families/${enc}/langs/add`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lang, agree: true }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; queued?: number };
      if (!res.ok) throw new Error(data.message ?? "Не получилось. Попробуйте ещё раз.");
      setDone({ queued: data.queued ?? 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Нет связи. Проверьте интернет и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col gap-3">
        <section className="flex flex-col gap-1 rounded-card border border-jade/40 bg-paper p-5">
          <p className="text-sm tracking-widest text-jade uppercase">Оплачено (демо) ✓</p>
          <p className="font-serif text-2xl">Язык добавлен: {name}</p>
          <p className="text-ink-soft">
            {done.queued > 0 ? `Переводим готовые главы (${done.queued}) — это займёт несколько минут.` : "Новые главы сразу будут с этим переводом."}
          </p>
        </section>
        <Link href={`/f/${enc}`} className="button flex items-center justify-center rounded-button bg-seal px-6 py-4 text-elder font-semibold text-paper">
          К книге
        </Link>
      </div>
    );
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
        onClick={() => void pay()}
        disabled={!agree || busy}
        className="rounded-button bg-seal px-6 py-4 text-elder font-semibold text-paper active:bg-seal-dark disabled:opacity-60"
      >
        {busy ? "Оформляем…" : `Оплатить ${price} (демо)`}
      </button>
      <p className="text-center text-sm text-muted">Демо: деньги не списываются</p>
    </div>
  );
}
