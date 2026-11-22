import type { Metadata } from "next";
import Link from "next/link";
import { getDemoOrderStore } from "@/app/api/checkout/orders";
import { getFamilyByToken } from "@/lib/db/access";
import { EXTRA_OPTIONS, formatKzt, planOfOrder, SOON_EXTRAS } from "@/lib/payments/plans";
import { LinkNotFound } from "../../_ui/LinkNotFound";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Книга семьи · допы", robots: { index: false, follow: false } };

const TALE = EXTRA_OPTIONS.find((e) => e.id === "tale");

// /extras/<token> — после демо-оплаты: «оплачено (демо)», сказка для внуков (I8) и «скоро»-карточки.
export default async function ExtrasPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await getFamilyByToken(token);
  if (!view) return <LinkNotFound />;

  const order = await getDemoOrderStore().latestPaid(view.family.id);
  const plan = order ? planOfOrder(order) : undefined;
  const withTale = order?.extras.includes("tale") ?? false;

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-5 py-8">
      <p className="text-sm tracking-widest text-muted uppercase">Книга семьи · 우리 이야기</p>

      {order ? (
        <section className="flex flex-col gap-2 rounded-card border border-jade/40 bg-paper p-5">
          <p className="text-sm tracking-widest text-jade uppercase">Оплачено (демо) · 결제 완료 (데모)</p>
          <h1 className="font-serif text-3xl leading-tight">Спасибо! Книга заказана</h1>
          <p className="text-ink-soft">
            {plan?.fullTitle ?? "Книга"} · {formatKzt(order.amount_kzt)}
          </p>
          <p className="text-sm text-muted">Это демонстрация: деньги не списывались, данные карты не запрашивались.</p>
        </section>
      ) : (
        <section className="flex flex-col gap-3 rounded-card bg-paper-deep p-5">
          <h1 className="font-serif text-3xl leading-tight">Допы к книге</h1>
          <p className="text-ink-soft">Сначала выберите книгу — после оплаты (демо) здесь откроются допы.</p>
          <Link
            href={`/checkout/${token}`}
            className="button flex items-center justify-center rounded-button bg-seal px-6 py-4 text-elder font-semibold text-paper active:bg-seal-dark"
          >
            Выбрать книгу
          </Link>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-serif text-2xl">Допы</h2>

        <article className="flex flex-col gap-3 rounded-card bg-paper-deep p-5 shadow-card">
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-serif text-2xl">Сказка для внуков</p>
              {TALE && (
                <span className="whitespace-nowrap text-jade">{withTale ? "оплачено (демо)" : formatKzt(TALE.priceKzt)}</span>
              )}
            </div>
            <p className="text-muted" lang="ko">
              손주를 위한 동화
            </p>
          </div>
          <p className="text-ink-soft">Добрая сказка по настоящим рассказам — с иллюстрациями в одном стиле.</p>
          {order ? (
            <Link
              href={`/extras/${token}/tale`}
              className="button flex items-center justify-center rounded-button bg-seal px-6 py-4 text-elder font-semibold text-paper active:bg-seal-dark"
            >
              {withTale ? "Открыть сказку" : "Создать сказку"}
            </Link>
          ) : (
            <p className="text-sm text-muted">Откроется после оплаты (демо).</p>
          )}
        </article>

        {SOON_EXTRAS.map((s) => (
          <article key={s.id} className="flex flex-col gap-1 rounded-card border border-line bg-paper p-5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-serif text-xl">{s.title}</p>
              <span className="whitespace-nowrap text-ink-soft">
                {formatKzt(s.priceKzt)}
                {s.per ?? ""}
              </span>
            </div>
            <p className="text-sm text-muted" lang="ko">
              {s.titleKo}
            </p>
            <p className="text-ink-soft">{s.note}</p>
            <span className="self-start rounded-button bg-paper-deep px-3 py-1 text-sm text-muted">скоро</span>
          </article>
        ))}
      </section>

      <Link href={`/f/${token}`} className="button flex items-center justify-center rounded-button border border-line px-6 py-3 text-ink">
        ← К книге семьи
      </Link>
    </main>
  );
}
