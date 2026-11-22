"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { DEFAULT_PLAN_ID, formatKzt, PRODUCT_TITLES, type ExtraOption, type Plan, type SoonExtra } from "@/lib/payments/plans";

const GROUPS = (["digital", "print"] as const).map((product) => ({ product, ...PRODUCT_TITLES[product] }));

// Выбор варианта и допов + кнопка «Оплатить (демо)». Повторное нажатие заблокировано, сервер тоже не плодит дубли.
export function CheckoutForm({
  token,
  plans,
  extras,
  soon = [],
}: {
  token: string;
  plans: Plan[];
  extras: ExtraOption[];
  soon?: SoonExtra[];
}) {
  const router = useRouter();
  const [planId, setPlanId] = useState(plans.some((p) => p.id === DEFAULT_PLAN_ID) ? DEFAULT_PLAN_ID : (plans[0]?.id ?? ""));
  // Допы платные — по умолчанию не отмечены: итог = выбранная книга.
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);

  const plan = plans.find((p) => p.id === planId);
  const total = (plan?.priceKzt ?? 0) + extras.filter((e) => chosen.includes(e.id)).reduce((s, e) => s + e.priceKzt, 0);

  async function pay() {
    if (sending.current || !plan) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json", "x-family-token": token },
        body: JSON.stringify({ plan: plan.id, extras: chosen }),
      });
      const data = (await res.json().catch(() => ({}))) as { orderId?: string; message?: string };
      if (!res.ok || !data.orderId) throw new Error(data.message ?? "Не получилось оформить. Попробуйте ещё раз.");
      router.push(`/extras/${token}?paid=1`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не получилось оформить. Попробуйте ещё раз.");
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {GROUPS.map((g) => (
        <fieldset key={g.product} className="flex flex-col gap-3">
          <legend className="mb-2 font-serif text-2xl">
            {g.title} <span className="text-base text-muted" lang="ko">{g.titleKo}</span>
          </legend>
          {plans
            .filter((p) => p.product === g.product)
            .map((p) => {
              const active = p.id === planId;
              return (
                <label
                  key={p.id}
                  className={`flex min-h-12 cursor-pointer items-start gap-3 rounded-card border p-4 ${
                    active ? "border-seal bg-paper-deep shadow-card" : "border-line bg-paper"
                  }`}
                >
                  <input
                    type="radio"
                    name="plan"
                    value={p.id}
                    checked={active}
                    onChange={() => setPlanId(p.id)}
                    className="mt-1 size-5 accent-seal"
                  />
                  <span className="flex flex-1 flex-col gap-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="font-semibold">{p.title}</span>
                      <span className="font-serif text-xl whitespace-nowrap">{formatKzt(p.priceKzt)}</span>
                    </span>
                    <span className="text-sm text-muted" lang="ko">
                      {p.titleKo}
                    </span>
                    <span className="text-sm text-ink-soft">{p.note}</span>
                  </span>
                </label>
              );
            })}
        </fieldset>
      ))}

      {extras.length > 0 && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 font-serif text-2xl">Допы</legend>
          {extras.map((e) => (
            <label key={e.id} className="flex min-h-12 cursor-pointer items-start gap-3 rounded-card border border-line bg-paper p-4">
              <input
                type="checkbox"
                checked={chosen.includes(e.id)}
                onChange={(ev) => setChosen((c) => (ev.target.checked ? [...c, e.id] : c.filter((x) => x !== e.id)))}
                className="mt-1 size-5 accent-seal"
              />
              <span className="flex flex-1 flex-col gap-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold">{e.title}</span>
                  <span className="whitespace-nowrap text-jade">{e.priceKzt > 0 ? formatKzt(e.priceKzt) : "в подарок"}</span>
                </span>
                <span className="text-sm text-muted" lang="ko">
                  {e.titleKo}
                </span>
                <span className="text-sm text-ink-soft">{e.note}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {soon.length > 0 && (
        <section aria-labelledby="soon-title" className="flex flex-col gap-3">
          <h2 id="soon-title" className="font-serif text-2xl">
            Скоро <span className="text-base text-muted" lang="ko">곧 출시</span>
          </h2>
          <ul className="flex flex-col gap-2">
            {soon.map((s) => (
              <li key={s.id} className="flex flex-col gap-1 rounded-card border border-line bg-paper p-4">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold">{s.title}</span>
                  <span className="whitespace-nowrap text-ink-soft">
                    {formatKzt(s.priceKzt)}
                    {s.per ?? ""}
                  </span>
                </span>
                <span className="text-sm text-muted" lang="ko">
                  {s.titleKo}
                </span>
                <span className="text-sm text-ink-soft">{s.note}</span>
                <span className="self-start rounded-button bg-paper-deep px-3 py-1 text-sm text-muted">скоро · без оплаты</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="sticky bottom-0 -mx-5 flex flex-col gap-2 border-t border-line bg-paper px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <p className="flex items-baseline justify-between">
          <span className="text-ink-soft">Итого</span>
          <span className="font-serif text-2xl">{formatKzt(total)}</span>
        </p>
        <button
          type="button"
          onClick={pay}
          disabled={busy || !plan}
          className="button flex items-center justify-center rounded-button bg-seal px-6 py-4 text-elder font-semibold text-paper active:bg-seal-dark disabled:opacity-60"
        >
          {busy ? "Оформляем…" : "Оплатить (демо)"}
        </button>
        <p className="text-center text-sm text-muted">Демо: деньги не списываются</p>
        {error && (
          <p role="alert" className="text-center text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
