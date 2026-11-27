import type { Metadata } from "next";
import Link from "next/link";
import { LinkNotFound } from "@/app/(family)/_ui/LinkNotFound";
import { BOOK_MIN_CHAPTERS, getBookView } from "@/lib/book/build";
import { lifeYears } from "@/lib/book/chapter";
import { getFamilyByToken } from "@/lib/db/access";
import { familyBookLangs } from "@/lib/pipeline/book-langs";
import { bookLangsPhrase, langUi } from "@/lib/pipeline/langs";
import { BookActions } from "./BookActions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Книга · Книга семьи", robots: { index: false, follow: false } };

function chaptersWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "глава";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "главы";
  return "глав";
}

// Экран книги /book/<токен семьи>: статус сборки, «открыть / скачать PDF», «собрать / пересобрать».
export default async function BookPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await getFamilyByToken(token);
  if (!view) return <LinkNotFound />;
  const { family, storyteller } = view;
  const book = await getBookView(family.id);
  const ready = book.chapters_ready;
  const builtAt = book.built_at
    ? new Date(book.built_at).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Almaty" })
    : null;
  const meta = [lifeYears(storyteller), storyteller?.birth_place].filter(Boolean).join(" · ");
  // #299: подписи по языкам книги — RU + KR как было, RU + KZ / только RU без корейского
  const langs = familyBookLangs(family);
  const ui = langUi(langs);
  const ko = langs.includes("ko");

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-5 py-8">
      <nav>
        <Link href={`/f/${token}`} className="inline-flex min-h-12 items-center text-ink-soft underline-offset-4 hover:underline">
          ← {family.name}
        </Link>
      </nav>

      <p className="text-sm tracking-widest text-muted uppercase">
        {ko ? (
          <>
            Книга семьи · <span lang="ko">우리 이야기</span>
          </>
        ) : (
          "Книга семьи"
        )}
      </p>

      {/* мини-обложка */}
      <section className="flex flex-col items-center gap-2 rounded-card bg-paper-deep px-6 py-10 text-center shadow-card">
        <div aria-hidden className="mb-4 h-px w-12 bg-gold" />
        <h1 className="font-serif text-3xl leading-tight">{storyteller?.name ?? family.name}</h1>
        {ko && storyteller?.name_ko && (
          <p className="font-serif text-xl text-ink-soft" lang="ko">
            {storyteller.name_ko}
          </p>
        )}
        {meta && <p className="text-sm text-muted">{meta}</p>}
        <p className="mt-6 border-t border-gold/60 pt-3 font-serif text-lg">{book.title ?? family.name}</p>
      </section>

      <section className="flex flex-col gap-2 text-elder">
        {book.status === "ready" && (
          <p>
            Книга готова: <b>{book.page_count}</b> стр. формата A5{builtAt ? `, собрана ${builtAt}` : ""}.
          </p>
        )}
        {book.outdated && (
          <p>
            В главах поправили имена{builtAt ? ` после сборки ${builtAt}` : ""}
            {`. Нажмите «Пересобрать», чтобы PDF обновился${ui ? ` — когда ${ui.name} перевод исправленных глав будет готов (обычно пара минут).` : "."}`}
          </p>
        )}
        {book.status === "building" && <p>Книга собирается — это меньше минуты.</p>}
        {book.status === "failed" && (
          <p className="text-danger">
            В прошлый раз собрать не получилось. Нажмите «{book.has_pdf ? "Пересобрать" : "Собрать книгу"}» ещё раз — обычно это помогает.
          </p>
        )}
        <p className="text-ink-soft">
          Готово для книги: {ready} {chaptersWord(ready)}.{" "}
          {ready === 0
            ? "Запишите первый рассказ — и здесь появится книга."
            : ready < BOOK_MIN_CHAPTERS
              ? `Книга будет полнее с ${BOOK_MIN_CHAPTERS} главами, но собрать можно уже сейчас.`
              : `В книге будут обложка, оглавление, главы ${bookLangsPhrase(langs)}, QR-коды на голос.`}
        </p>
      </section>

      <BookActions familyId={family.id} token={token} hasPdf={book.has_pdf} building={book.status === "building"} canBuild={ready > 0} />
    </main>
  );
}
