// /center/families — семьи и истории: источник, рассказчики, число историй, статус книги.
// Вкладка «Архив АКНЦ» — только семьи с archive_consent = true. Демо-семьи скрываются фильтром.
import type { Metadata } from "next";
import Link from "next/link";
import { Notice } from "@/components/admin/ui";
import { FamilyCard } from "@/components/center/Readouts";
import { CenterShell } from "@/components/center/Shell";
import { centerHref } from "@/components/center/ui";
import { loadCenter, requireCenter, type CenterData } from "@/app/api/center/_lib/http";
import { filterFamilies, type FamilyView } from "@/app/api/center/_lib/stats";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Семьи · кабинет АКНЦ", robots: { index: false, follow: false } };

type Search = Promise<Record<string, string | string[] | undefined>>;

const VIEWS: { view: FamilyView; label: string }[] = [
  { view: "all", label: "Все" },
  { view: "kiosk", label: "Киоск" },
  { view: "family", label: "Семьи сами" },
  { view: "archive", label: "Архив АКНЦ" },
];

export default async function CenterFamiliesPage({ searchParams }: { searchParams: Search }) {
  await requireCenter();
  const sp = await searchParams;
  const hideDemo = sp.demo === "hide";
  const view = (VIEWS.find((v) => v.view === sp.view)?.view ?? "all") as FamilyView;

  let data: CenterData | null = null;
  try {
    data = await loadCenter({ hideDemo });
  } catch (e) {
    console.error("[center]", e instanceof Error ? e.message : e);
  }
  const list = data ? filterFamilies(data.families, view) : [];

  return (
    <CenterShell title="Семьи и истории" tab="families" hideDemo={hideDemo}>
      <nav className="flex gap-2 overflow-x-auto text-sm" aria-label="Фильтр семей">
        {VIEWS.map((v) => (
          <Link
            key={v.view}
            href={centerHref("/center/families", hideDemo, v.view === "all" ? {} : { view: v.view })}
            aria-current={v.view === view ? "page" : undefined}
            className={`flex min-h-12 shrink-0 items-center rounded-button border px-4 ${
              v.view === view ? "border-seal bg-seal text-paper" : "border-line bg-paper text-ink"
            }`}
          >
            {v.label}
          </Link>
        ))}
      </nav>
      {view === "archive" ? (
        <Notice tone="info">Здесь только семьи, которые дали согласие на хранение записей в архиве АКНЦ.</Notice>
      ) : null}
      {!data ? <Notice tone="err">Не удалось прочитать данные. Обновите страницу через минуту.</Notice> : null}
      {data && list.length === 0 ? (
        <p className="rounded-card bg-paper-deep p-5 text-center text-ink-soft">
          {view === "archive" ? "Пока никто не дал согласия на архив." : "Семей пока нет."}
        </p>
      ) : null}
      {list.length > 0 ? (
        <>
          <p className="text-sm text-muted">Семей: {list.length}</p>
          <ul className="flex flex-col gap-2">
            {list.map((f) => (
              <FamilyCard key={f.id} f={f} />
            ))}
          </ul>
        </>
      ) : null}
    </CenterShell>
  );
}
