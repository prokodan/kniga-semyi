import Link from "next/link";
import { KioskTabs } from "@/components/kiosk/KioskTabs";
import { kPrimary } from "@/components/kiosk/ui";
import { loadShow } from "@/app/api/kiosk/_lib/archive";
import { requireKiosk } from "@/app/api/kiosk/_lib/session";

export const dynamic = "force-dynamic";

const years = (f: { birthYear: number | null; birthPlace: string | null }) => [f.birthYear ? `${f.birthYear} г. р.` : null, f.birthPlace].filter(Boolean).join(" · ");

// /kiosk/archive — «Архив»: семьи киоска, согласившиеся на архив АКНЦ, и их главы RU | KR. Только чтение, без ссылок
// на книгу семьи и без голоса (см. app/api/kiosk/_lib/archive.ts). «▶ Показ» — полноэкранная витрина для зала.
export default async function KioskArchivePage() {
  await requireKiosk();
  const families = await loadShow();
  const chapters = families.reduce((n, f) => n + f.chapters.length, 0);

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-6 sm:px-8">
      <header className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1 basis-60">
          <h1 className="font-serif text-4xl">Архив</h1>
          <p className="text-muted">
            <span lang="ko">구술 기록 보관소</span> · семьи, которые согласились передать записи в архив АКНЦ
          </p>
        </div>
        <KioskTabs current="/kiosk/archive" />
        {chapters > 0 && (
          <Link href="/kiosk/archive/show" className={`${kPrimary} w-full sm:w-auto`}>
            ▶ Показ
          </Link>
        )}
      </header>

      {families.length === 0 ? (
        <p className="rounded-card bg-paper-deep p-8 text-center text-ink-soft">
          В архиве пока нет готовых глав. Они появятся здесь, когда семья отметит «в архив АКНЦ» и главы соберутся.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {families.map((f) => (
            <li key={f.id} className="flex flex-col gap-3 rounded-card bg-paper-deep p-5 shadow-card">
              <div>
                <p className="font-serif text-2xl break-words">
                  {f.name}
                  {f.nameKo && (
                    <span className="text-ink-soft" lang="ko">
                      {" "}
                      · {f.nameKo}
                    </span>
                  )}
                  {f.isDemo && <span className="ml-2 align-middle text-base text-muted">пример</span>}
                </p>
                {years(f) && <p className="text-ink-soft">{years(f)}</p>}
              </div>
              <ol className="flex flex-col gap-2">
                {f.chapters.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/kiosk/archive/show?from=${encodeURIComponent(c.id)}`}
                      className="flex min-h-12 flex-col justify-center rounded-card bg-paper px-4 py-2 active:bg-paper-deep"
                    >
                      <span className="text-base text-muted">{c.section}</span>
                      <span className="break-words">{c.title}</span>
                      {c.titleKo && (
                        <span className="text-base break-words text-ink-soft" lang="ko">
                          {c.titleKo}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
