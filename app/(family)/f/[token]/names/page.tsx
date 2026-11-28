import type { Metadata } from "next";
import Link from "next/link";
import { getBookView } from "@/lib/book/build";
import { getFamilyByToken } from "@/lib/db/access";
import { entityService } from "@/lib/entities";
import { familyBookLangs } from "@/lib/pipeline/book-langs";
import { langUi } from "@/lib/pipeline/langs";
import { LinkNotFound } from "../../../_ui/LinkNotFound";
import { NamesEditor, type ChapterRef } from "./NamesEditor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Словарь имён · Книга семьи", robots: { index: false, follow: false } };

// /f/<токен>/names — словарь имён семьи (#104): люди, места и особые слова книги в одном месте.
// Исправили написание здесь — оно меняется во всех главах, перевод этих глав (второй язык книги) обновляется.
// #299: корейские подписи и поле «По-корейски» — только у книги RU + KR; RU + KZ — «казахский перевод», только RU — без перевода.
// #311: RU + KZ (флаг lang_kk — внутри familyBookLangs) — у людей и мест поле «По-казахски» (name_kk).
export default async function NamesPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await getFamilyByToken(token);
  if (!view) return <LinkNotFound />;
  const { family } = view;
  const langs = familyBookLangs(family);
  const ko = langs.includes("ko");
  const ui = langUi(langs);
  const svc = entityService();
  const [entities, chapters, book] = await Promise.all([svc.list(family.id), svc.chapters(family.id), getBookView(family.id)]);
  // #166: глава ещё не собрана — «глава собирается…» (ссылка ведёт на экран ожидания /chapter/<id>)
  const refs: ChapterRef[] = chapters.map((c, i) => ({
    id: c.id,
    title: c.title?.trim() || (c.status === "ready" ? `Глава ${i + 1}` : "глава собирается…"),
  }));

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-5 py-8">
      <nav>
        <Link href={`/f/${token}`} className="inline-flex min-h-12 items-center text-ink-soft underline-offset-4 hover:underline">
          ← {family.name}
        </Link>
      </nav>

      <header className="flex flex-col gap-2">
        {ko ? (
          <>
            <p className="text-sm tracking-widest text-muted uppercase">
              Книга семьи · <span lang="ko">우리 이야기</span>
            </p>
            <h1 className="font-serif text-3xl leading-tight">
              Словарь имён <span className="text-ink-soft" lang="ko">· 이름 사전</span>
            </h1>
            <p className="text-ink-soft">
              Все люди, места и особые слова из глав — в одном месте. Исправьте написание здесь, и оно поменяется во всех главах книги,
              а корейский перевод этих глав обновится сам.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm tracking-widest text-muted uppercase">Книга семьи</p>
            <h1 className="font-serif text-3xl leading-tight">Словарь имён</h1>
            <p className="text-ink-soft">
              Все люди, места и особые слова из глав — в одном месте. Исправьте написание здесь, и оно поменяется во всех главах книги
              {ui ? `, а ${ui.name} перевод этих глав обновится сам.` : "."}
            </p>
          </>
        )}
      </header>

      {book.outdated && (
        <Link href={`/book/${token}`} className="flex min-h-12 items-center justify-between gap-3 rounded-card border border-gold bg-paper-deep px-4 py-3">
          <span>Имена в главах поправлены — пересоберите книгу, чтобы PDF обновился</span>
          <span className="text-seal">→</span>
        </Link>
      )}

      <NamesEditor token={token} entities={entities} chapters={refs} ko={ko} kk={langs.includes("kk")} />
    </main>
  );
}
