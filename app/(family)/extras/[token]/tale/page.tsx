import type { Metadata } from "next";
import Link from "next/link";
import { TaleBook } from "@/components/tale/TaleBook";
import { getFamilyByToken } from "@/lib/db/access";
import { getTaleView } from "@/lib/tale";
import { LinkNotFound } from "../../../_ui/LinkNotFound";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Книга семьи · сказка для внуков", robots: { index: false, follow: false } };

// /extras/<token>/tale — сказка для внуков (I8): создать по готовым главам и листать как книжку.
export default async function TalePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await getFamilyByToken(token);
  if (!view) return <LinkNotFound />;
  const tale = await getTaleView(view.family.id);

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-5 py-8">
      <div className="flex flex-col gap-1">
        <p className="text-sm tracking-widest text-muted uppercase">Книга семьи · 우리 이야기</p>
        <h1 className="font-serif text-3xl leading-tight">Сказка для внуков</h1>
        <p className="text-muted" lang="ko">
          손주를 위한 동화
        </p>
      </div>

      <TaleBook token={token} initial={tale} />

      <Link href={`/extras/${token}`} className="button flex items-center justify-center rounded-button border border-line px-6 py-3 text-ink">
        ← К допам
      </Link>
    </main>
  );
}
