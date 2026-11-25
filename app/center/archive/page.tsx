// /center/archive — витрина «Архив АКНЦ»: книги и главы рассказчиков с согласием на архив (archive_consent).
// #201: только семьи киоска. Режим показа (?show=1) отсюда убран — он переехал в киоск (#200).
import type { Metadata } from "next";
import { Notice } from "@/components/admin/ui";
import { CenterShell } from "@/components/center/Shell";
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

function FamilyArchive({ f }: { f: ArchiveFamily }) {
  const st = f.storyteller;
  const years = st?.birthYear ? `${st.birthYear} г. р.` : null;
  return (
    <article
      id={`f-${f.id}`}
      className="flex flex-col gap-4 rounded-card bg-paper-deep p-5 shadow-card"
    >
      <header className="flex flex-col gap-1">
        <p className="text-sm tracking-widest text-seal uppercase">
          Архив АКНЦ · <span lang="ko">기록 보관소</span>
          {f.isDemo ? <span className="ml-2 text-warning normal-case">пример</span> : null}
        </p>
        <h2 className="font-serif text-3xl leading-tight">{st?.name ?? f.name}</h2>
        {st?.nameKo ? (
          <p className="text-lg text-ink-soft" lang="ko">
            {st.nameKo}
          </p>
        ) : null}
        <p className="text-ink-soft">{[years, st?.birthPlace, f.name].filter(Boolean).join(" · ")}</p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <a href={f.bookHref} className={`${pill} bg-seal text-paper active:bg-seal-dark`}>
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
        <ol className="grid gap-3">
          {f.chapters.map((c, i) => (
            <li key={c.id} className="flex flex-col gap-2 rounded-card border border-line bg-paper p-4">
              <p className="text-xs tracking-widest text-muted uppercase">
                {c.section} <span lang="ko">· {c.sectionKo}</span>
              </p>
              <p className="font-serif text-xl leading-snug">
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
  const hideDemo = (await searchParams).demo === "hide";

  let list: ArchiveFamily[] | null = null;
  try {
    list = await loadArchive({ hideDemo });
  } catch (e) {
    console.error("[center] архив:", e instanceof Error ? e.message : e);
  }

  return (
    <CenterShell title="Архив АКНЦ" tab="archive" hideDemo={hideDemo}>
      <p className="text-ink-soft">
        Книги и главы рассказчиков, записанных в центре, которые дали согласие на хранение в архиве: текст RU · KR и живой голос.
      </p>
      {!list ? <Notice tone="err">Не удалось прочитать архив. Обновите страницу через минуту.</Notice> : null}
      {list && list.length === 0 ? (
        <p className="rounded-card bg-paper-deep p-5 text-center text-ink-soft">
          Пока никто не дал согласия на хранение записей в архиве АКНЦ.
        </p>
      ) : null}
      {list?.map((f) => <FamilyArchive key={f.id} f={f} />)}
    </CenterShell>
  );
}
