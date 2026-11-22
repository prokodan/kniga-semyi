import type { Metadata } from "next";
import Link from "next/link";
import { getDemoOrderStore } from "@/app/api/checkout/orders";
import { getFamilyByToken } from "@/lib/db/access";
import { B2B_KZT_PER_STORY } from "@/lib/payments";
import { LinkNotFound } from "../../_ui/LinkNotFound";
import { CheckoutForm } from "./CheckoutForm";
import { EXTRA_OPTIONS, formatKzt, PLANS, planOfOrder } from "./plans";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Книга семьи · выбор книги", robots: { index: false, follow: false } };

// /checkout/<token> — выбор «цифра / печать» по ценам финмодели и допов → «оплачено (демо)».
export default async function CheckoutPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await getFamilyByToken(token);
  if (!view) return <LinkNotFound />;

  const paid = await getDemoOrderStore().latestPaid(view.family.id);
  const paidPlan = paid ? planOfOrder(paid) : undefined;

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-5 py-8">
      <p className="text-sm tracking-widest text-muted uppercase">Книга семьи · 우리 이야기</p>
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-3xl leading-tight">Какой будет ваша книга?</h1>
        <p className="text-ink-soft">{view.family.name}</p>
      </div>

      <p role="note" className="rounded-card border border-gold/50 bg-paper-deep p-4 text-ink-soft">
        <strong className="text-ink">Это демонстрация оплаты.</strong> Деньги не списываются, данные карты не нужны — после
        нажатия заказ сразу будет отмечен «оплачено (демо)».
      </p>

      {paid && (
        <section className="flex flex-col gap-3 rounded-card border border-jade/40 bg-paper p-5">
          <p className="font-serif text-xl">
            Оплачено (демо) ✓ · {paidPlan?.title ?? "книга"} · {formatKzt(paid.amount_kzt)}
          </p>
          <Link
            href={`/extras/${token}`}
            className="button flex items-center justify-center rounded-button bg-jade px-6 py-3 font-semibold text-paper"
          >
            К допам →
          </Link>
        </section>
      )}

      <CheckoutForm token={token} plans={PLANS} extras={EXTRA_OPTIONS} />

      <p className="border-t border-line pt-5 text-sm text-muted">
        Для Алматинского корейского национального центра: {formatKzt(B2B_KZT_PER_STORY)} за записанную историю старейшины.
      </p>
    </main>
  );
}
