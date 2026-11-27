import type { Metadata } from "next";
import { getFamilyByToken } from "@/lib/db/access";
import { familyBookLangs } from "@/lib/pipeline/book-langs";
import { LinkNotFound } from "../../_ui/LinkNotFound";
import { ConsentRecorder } from "./ConsentRecorder";
import { consentText } from "./text";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Согласие на запись · Книга семьи", robots: { index: false, follow: false } };

// Голосовое согласие — обязательно до первой записи рассказчика.
export default async function ConsentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await getFamilyByToken(token);
  if (!view || !view.storyteller) return <LinkNotFound />;
  const st = view.storyteller;

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-5 py-8">
      <p className="text-sm tracking-widest text-muted uppercase">Шаг 1 из 2 · согласие</p>
      <h1 className="font-serif text-3xl leading-tight">Согласие на запись</h1>
      <p className="text-ink-soft">
        Перед первым рассказом попросите {st.name} прочитать вслух или повторить за вами эти слова. Это займёт меньше минуты.
      </p>
      <blockquote className="rounded-card border-l-4 border-seal bg-paper-deep p-5 text-elder text-ink">{consentText(st.name, familyBookLangs(view.family))}</blockquote>
      <ConsentRecorder token={token} storytellerId={st.id} already={Boolean(st.consent_at)} />
    </main>
  );
}
