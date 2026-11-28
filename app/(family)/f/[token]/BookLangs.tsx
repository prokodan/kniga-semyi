"use client";
// #231 (флаг lang_kk): «Языки книги» на странице семьи — RU + KR / RU + KZ / только RU, одна цена.
// Сервер решает, показывать ли блок (флаг), и передаёт текущий выбор; сохранение — PATCH /api/families/<токен>/langs.
// #306 (флаг lang_change, проп `change`): выбор другого варианта ведёт на экран согласия /consent/<токен>/langs (галочка
// «Согласен»); после первой готовой главы варианты закрыты — только «Добавить язык» → /checkout/<токен>/lang (демо-оплата).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatKzt } from "@/lib/payments/plans";
import { LANG_LOCK_WARNING, type AddLangOffer } from "@/lib/payments/langs";
import { BOOK_LANG_CHOICES, type BookLangChoice } from "@/lib/pipeline/langs";

export interface BookLangsChange {
  /** Первая (бесплатная) глава готова — базовые языки не меняются */
  locked: boolean;
  /** Докупленные языки: «казахский» */
  extras: string[];
  offers: AddLangOffer[];
}

export function BookLangs({ token, current, change }: { token: string; current: BookLangChoice | null; change?: BookLangsChange }) {
  if (change) return <BookLangsChangeable token={token} current={current} change={change} />;
  return <BookLangsFree token={token} current={current} />;
}

/** #306: «Языки книги» с согласием, блокировкой и «Добавить язык». */
function BookLangsChangeable({ token, current, change }: { token: string; current: BookLangChoice | null; change: BookLangsChange }) {
  const enc = encodeURIComponent(token);
  return (
    <section className="flex flex-col gap-3 rounded-card border border-line bg-paper p-4" aria-labelledby="book-langs">
      <h2 id="book-langs" className="font-serif text-xl">
        Языки книги
      </h2>
      <p className="text-sm text-ink-soft">Глава всегда по-русски, рядом — перевод. Цена одна для любого варианта.</p>
      {change.locked ? (
        <p className="rounded-card bg-paper-deep p-3 text-sm text-ink-soft">
          Первая глава готова — языки книги уже не меняются. Можно добавить ещё один язык.
        </p>
      ) : (
        <p className="rounded-card border border-gold bg-paper-deep p-3 text-sm text-ink-soft">
          <strong>Важно.</strong> {LANG_LOCK_WARNING}
        </p>
      )}
      <div role="radiogroup" aria-labelledby="book-langs" className="flex flex-col gap-2">
        {BOOK_LANG_CHOICES.map((c) => {
          const on = current === c.id;
          const body = (
            <>
              <span className="text-lg font-semibold">
                {on ? "✓ " : ""}
                {c.label}
              </span>
              <span className="text-sm text-muted">{c.hint}</span>
            </>
          );
          const cls = `flex min-h-12 flex-col items-start rounded-card border px-4 py-3 text-left ${on ? "border-seal bg-paper-deep" : "border-line bg-paper"}`;
          if (on || change.locked) {
            return (
              <div key={c.id} role="radio" aria-checked={on} aria-disabled={!on} className={`${cls} ${on ? "" : "opacity-60"}`}>
                {body}
              </div>
            );
          }
          return (
            <Link key={c.id} role="radio" aria-checked={false} href={`/consent/${enc}/langs?to=${encodeURIComponent(c.id)}`} className={cls}>
              {body}
            </Link>
          );
        })}
      </div>
      {change.extras.length > 0 && <p className="text-sm text-jade">Добавлено: {change.extras.join(", ")} ✓</p>}
      {change.locked &&
        change.offers.map((o) => (
          <Link
            key={o.lang}
            href={`/checkout/${enc}/lang?add=${o.lang}`}
            className="button flex min-h-12 items-center justify-between gap-3 rounded-button border border-seal bg-paper px-4 py-3 font-semibold text-seal"
          >
            <span>{o.label}</span>
            <span>{formatKzt(o.priceKzt)}</span>
          </Link>
        ))}
    </section>
  );
}

function BookLangsFree({ token, current }: { token: string; current: BookLangChoice | null }) {
  const router = useRouter();
  const [value, setValue] = useState<BookLangChoice | null>(current);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function choose(id: BookLangChoice) {
    if (busy || id === value) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/families/${encodeURIComponent(token)}/langs`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ langs: id }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; queued?: number };
      if (!res.ok) throw new Error(data.message ?? "Не получилось сохранить. Попробуйте ещё раз.");
      setValue(id);
      setNote({
        ok: true,
        text: data.queued ? `Сохранено. Переводим готовые главы (${data.queued}) — это займёт несколько минут.` : "Сохранено.",
      });
      router.refresh();
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "Нет связи. Проверьте интернет и попробуйте ещё раз." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-card border border-line bg-paper p-4" aria-labelledby="book-langs">
      <h2 id="book-langs" className="font-serif text-xl">
        Языки книги
      </h2>
      <p className="text-sm text-ink-soft">Глава всегда по-русски, рядом — перевод. Цена одна для любого варианта.</p>
      <div role="radiogroup" aria-labelledby="book-langs" className="flex flex-col gap-2">
        {BOOK_LANG_CHOICES.map((c) => {
          const on = value === c.id;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={busy}
              onClick={() => void choose(c.id)}
              className={`flex min-h-12 flex-col items-start rounded-card border px-4 py-3 text-left disabled:opacity-60 ${on ? "border-seal bg-paper-deep" : "border-line bg-paper"}`}
            >
              <span className="text-lg font-semibold">
                {on ? "✓ " : ""}
                {c.label}
              </span>
              <span className="text-sm text-muted">{c.hint}</span>
            </button>
          );
        })}
      </div>
      {note && <p className={`text-sm ${note.ok ? "text-jade" : "text-danger"}`}>{note.text}</p>}
    </section>
  );
}
