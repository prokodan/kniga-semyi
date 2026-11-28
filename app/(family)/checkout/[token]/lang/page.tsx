import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { consentText } from "@/app/(family)/consent/[token]/text";
import { getFamilyByToken } from "@/lib/db/access";
import { flag } from "@/lib/flags";
import { LANG_EXTRA_KZT } from "@/lib/payments";
import { addableLangs, langName, langsLocked, withAddedLang } from "@/lib/payments/langs";
import { formatKzt } from "@/lib/payments/plans";
import { effectiveBookLangs } from "@/lib/pipeline/langs";
import { LinkNotFound } from "../../../_ui/LinkNotFound";
import { AddLangForm } from "./AddLangForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Добавить язык · Книга семьи", robots: { index: false, follow: false } };

// #306 (флаги lang_kk + lang_change): «Добавить язык» после первой готовой (бесплатной) главы — демо-оплата
// (денег нет, lib/payments) → язык в book_langs → готовые главы переводятся. Цена — черновик 4 900 ₸ (#236).
export default async function AddLangPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ add?: string }> }) {
  const { token } = await params;
  const { add } = await searchParams;
  const view = await getFamilyByToken(token);
  if (!view) return <LinkNotFound />;
  const { family, storyteller } = view;
  const ctx = { familyId: family.id, labs: family.labs };
  if (!flag("lang_kk", ctx) || !flag("lang_change", ctx)) redirect(`/f/${token}`);
  const current = effectiveBookLangs(family, true);
  const lang = addableLangs(current).find((l) => l === add);
  if (!lang || !langsLocked(view.stories)) redirect(`/f/${token}`);
  const name = langName(lang);
  const langs = withAddedLang(current, lang);

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-5 py-8">
      <p className="text-sm tracking-widest text-muted uppercase">Языки книги · ещё один язык</p>
      <h1 className="font-serif text-3xl leading-tight">Добавить {name}</h1>
      <p className="text-ink-soft">
        Все главы книги переведём на {name} — и готовые, и будущие. Остальные языки книги остаются как есть.
      </p>
      <p className="flex items-baseline justify-between gap-3 rounded-card bg-paper-deep p-4 text-lg">
        <span>Ещё один язык книги</span>
        <span className="font-semibold whitespace-nowrap">{formatKzt(LANG_EXTRA_KZT)}</span>
      </p>
      <p className="rounded-card border border-line bg-paper p-4 text-ink-soft">
        <strong className="text-ink">Это демонстрация оплаты.</strong> Деньги не списываются, данные карты не нужны.
      </p>
      <p className="text-ink-soft">С новым языком меняется текст согласия — прочитайте его вместе с {storyteller?.name ?? "рассказчиком"} и отметьте галочку:</p>
      <blockquote className="rounded-card border-l-4 border-seal bg-paper-deep p-5 text-elder text-ink">
        {consentText(storyteller?.name ?? "рассказчик", langs)}
      </blockquote>
      <AddLangForm token={token} lang={lang} name={name} price={formatKzt(LANG_EXTRA_KZT)} />
      <Link href={`/f/${token}`} className="text-center text-ink-soft underline underline-offset-4">
        Вернуться к книге
      </Link>
    </main>
  );
}
