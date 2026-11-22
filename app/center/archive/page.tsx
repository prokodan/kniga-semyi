// /center/archive — витрина «Архив АКНЦ»: книги и главы рассказчиков с согласием на архив (archive_consent).
// ?show=1 — режим показа для презентации с планшета: крупно, без вкладок кабинета, по одной семье на экран.
import type { Metadata } from "next";
import Link from "next/link";
import { Notice } from "@/components/admin/ui";
import { CenterShell } from "@/components/center/Shell";
import { centerHref } from "@/components/center/ui";
import { loadArchive, type ArchiveFamily } from "@/app/api/center/_lib/archive";
import { requireCenter } from "@/app/api/center/_lib/http";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Архив АКНЦ · кабинет", robots: { index: false, follow: false } };

type Search = Promise<Record<string, string | string[] | undefined>>;

const BOOK: Record<ArchiveFamily["book"]["status"], string> = {
  none: "книга ещё не собрана",
  draft: "книга: черновик",
  building: "книга собирается",
  ready: "книга готова",
  failed: "книгу нужно пересобрать",
};

const pill = "flex min-h-12 items-center justify-center rounded-button px-5 font-semibold";

function FamilyArchive({ f, show }: { f: ArchiveFamily; show: boolean }) {
  const st = f.storyteller;
  const years = st?.birthYear ? `${st.birthYear} г. р.` : null;
  return (
    <article
      id={`f-${f.id}`}
      className={`flex flex-col gap-4 rounded-card bg-paper-deep shadow-card ${show ? "min-h-[85vh] snap-start p-6 sm:p-10" : "p-5"}`}
    >
      <header className="flex flex-col gap-1">
        <p className="text-sm tracking-widest text-seal uppercase">
          Архив АКНЦ · <span lang="ko">기록 보관소</span>
          {f.isDemo ? <span className="ml-2 text-warning normal-case">пример</span> : null}
        </p>
        <h2 className={`font-serif leading-tight ${show ? "text-5xl" : "text-3xl"}`}>{st?.name ?? f.name}</h2>
        {st?.nameKo ? (
          <p className={`text-ink-soft ${show ? "text-2xl" : "text-lg"}`} lang="ko">
            {st.nameKo}
          </p>
        ) : null}
        <p className="text-ink-soft">{[years, st?.birthPlace, f.name].filter(Boolean).join(" · ")}</p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <a href={f.bookHref} className={`${pill} bg-seal text-paper active:bg-seal-dark ${show ? "text-elder" : ""}`}>
          Открыть книгу
        </a>
        <span className="text-sm text-muted">
          {BOOK[f.book.status]}
          {f.book.pages ? ` · ${f.book.pages} стр.` : ""} · глав: {f.chapters.length}
        </span>
      </div>

      {f.chapters.length === 0 ? (
        <p className="text-ink-soft">Готовых глав пока нет.</p>
      ) : (
        <ol className={`grid gap-3 ${show ? "sm:grid-cols-2" : ""}`}>
          {f.chapters.map((c, i) => (
            <li key={c.id} className="flex flex-col gap-2 rounded-card border border-line bg-paper p-4">
              <p className="text-xs tracking-widest text-muted uppercase">
                {c.section} <span lang="ko">· {c.sectionKo}</span>
              </p>
              <p className={`font-serif leading-snug ${show ? "text-2xl" : "text-xl"}`}>
                {i + 1}. {c.title}
              </p>
              {c.titleKo ? (
                <p className="text-ink-soft" lang="ko">
                  {c.titleKo}
                </p>
              ) : null}
              {c.quote ? <p className="font-serif text-ink-soft italic">«{c.quote}»</p> : null}
              <div className="mt-auto flex flex-wrap gap-2 pt-1">
                <a href={c.chapterHref} className={`${pill} border border-line bg-paper text-ink`}>
                  Глава RU · KR
                </a>
                {c.voiceHref ? (
                  <a href={c.voiceHref} className={`${pill} bg-jade text-paper`}>
                    ▶ Голос{c.minutes ? ` · ${String(c.minutes).replace(".", ",")} мин` : ""}
                  </a>
                ) : (
                  <span className="flex min-h-12 items-center text-sm text-muted">голоса нет</span>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

export default async function CenterArchivePage({ searchParams }: { searchParams: Search }) {
  await requireCenter();
  const sp = await searchParams;
  const hideDemo = sp.demo === "hide";
  const show = sp.show === "1";

  let list: ArchiveFamily[] | null = null;
  try {
    list = await loadArchive({ hideDemo });
  } catch (e) {
    console.error("[center] архив:", e instanceof Error ? e.message : e);
  }

  const body = (
    <>
      {!list ? <Notice tone="err">Не удалось прочитать архив. Обновите страницу через минуту.</Notice> : null}
      {list && list.length === 0 ? (
        <p className="rounded-card bg-paper-deep p-5 text-center text-ink-soft">
          Пока никто не дал согласия на хранение записей в архиве АКНЦ.
        </p>
      ) : null}
      {list?.map((f) => <FamilyArchive key={f.id} f={f} show={show} />)}
    </>
  );

  if (show) {
    return (
      <main className="mx-auto flex max-w-5xl snap-y snap-mandatory flex-col gap-6 px-4 py-6 sm:px-8">
        <header className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm tracking-widest text-muted uppercase">АКНЦ · 알마티 고려인 민족 센터</p>
            <h1 className="font-serif text-4xl">Голоса старейшин · 어르신들의 목소리</h1>
          </div>
          <Link href={centerHref("/center/archive", hideDemo)} className={`${pill} border border-line bg-paper text-ink-soft`}>
            ✕ Выйти из показа
          </Link>
        </header>
        {list && list.length > 0 ? <p className="text-ink-soft">Рассказчиков в архиве: {list.length} · листайте вниз</p> : null}
        {body}
      </main>
    );
  }

  return (
    <CenterShell title="Архив АКНЦ" tab="archive" hideDemo={hideDemo}>
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-ink-soft">
          Книги и главы рассказчиков, которые дали согласие на хранение в архиве центра: текст RU · KR и живой голос.
        </p>
        <Link href={centerHref("/center/archive", hideDemo, { show: "1" })} className={`${pill} bg-ink text-paper`}>
          ▶ Режим показа
        </Link>
      </div>
      {body}
    </CenterShell>
  );
}
