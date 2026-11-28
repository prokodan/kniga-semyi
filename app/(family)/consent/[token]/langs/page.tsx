import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getFamilyByToken } from "@/lib/db/access";
import { flag } from "@/lib/flags";
import { LANG_LOCK_WARNING, langsLocked } from "@/lib/payments/langs";
import { BOOK_LANG_CHOICES, effectiveBookLangs } from "@/lib/pipeline/langs";
import { LinkNotFound } from "../../../_ui/LinkNotFound";
import { consentText } from "../text";
import { LangConsentForm } from "./LangConsentForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Новые языки книги · согласие", robots: { index: false, follow: false } };

// #306 (флаги lang_kk + lang_change): смена языков книги до первой готовой главы — новый текст согласия по новым
// языкам и галочка «Согласен» (голос заново не записываем). Галочка, дата и текст — book_lang_consents (PATCH langs).
export default async function LangConsentPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ to?: string }> }) {
  const { token } = await params;
  const { to } = await searchParams;
  const view = await getFamilyByToken(token);
  if (!view) return <LinkNotFound />;
  const { family, storyteller } = view;
  const ctx = { familyId: family.id, labs: family.labs };
  const choice = BOOK_LANG_CHOICES.find((c) => c.id === to);
  if (!flag("lang_kk", ctx) || !flag("lang_change", ctx) || !choice) redirect(`/f/${token}`);
  const current = effectiveBookLangs(family, true);
  if (current.join(",") === choice.langs.join(",")) redirect(`/f/${token}`);
  const locked = langsLocked(view.stories);
  const name = storyteller?.name ?? "рассказчик";

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-5 py-8">
      <p className="text-sm tracking-widest text-muted uppercase">Языки книги · согласие</p>
      <h1 className="font-serif text-3xl leading-tight">{choice.label}</h1>
      {locked ? (
        <>
          <p className="rounded-card border border-line bg-paper-deep p-4 text-ink-soft">
            Первая глава уже готова — сменить язык книги нельзя. Можно добавить ещё один язык на странице книги.
          </p>
          <Link href={`/f/${token}`} className="button flex items-center justify-center rounded-button bg-seal px-6 py-4 text-elder font-semibold text-paper">
            На страницу книги
          </Link>
        </>
      ) : (
        <>
          <p className="text-ink-soft">
            С новыми языками меняется текст согласия. Прочитайте его вместе с {name} и отметьте галочку — записывать голос
            заново не нужно.
          </p>
          <blockquote className="rounded-card border-l-4 border-seal bg-paper-deep p-5 text-elder text-ink">{consentText(name, choice.langs)}</blockquote>
          <p className="rounded-card border border-gold bg-paper p-3 text-ink-soft">
            <strong>Важно.</strong> {LANG_LOCK_WARNING}
          </p>
          <LangConsentForm token={token} langs={choice.id} />
        </>
      )}
      <Link href={`/f/${token}`} className="text-center text-ink-soft underline underline-offset-4">
        Оставить как было
      </Link>
    </main>
  );
}
