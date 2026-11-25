// /admin/families — наша админка «Семьи» (#201): все семьи (family и kiosk), источник, главы готово / всего,
// статус книги, цена книги (тариф + допы из demo_orders), расход ИИ, ссылки на семью, книгу и словарь имён.
// Вход — наш ADMIN_PIN (cookie та же, что у /admin и /admin/ai). Токены семей — только в ссылках этой страницы.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, fmtUsd, Notice } from "@/components/admin/ui";
import { formatKzt } from "@/lib/payments/plans";
import { isAdmin, isAdminConfigured } from "../ai/_lib/session";
import { buildAdminFamilies, filterAdminFamilies, priceLabel, totals, type AdminFamily, type SourceView } from "./_lib/families";
import { loadAdminFamilyRows } from "./_lib/load";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Семьи · админка · Книга семьи", robots: { index: false, follow: false } };

type Search = Promise<Record<string, string | string[] | undefined>>;

const VIEWS: { view: SourceView; label: string }[] = [
  { view: "all", label: "Все" },
  { view: "family", label: "Сами (/start)" },
  { view: "kiosk", label: "Киоск АКНЦ" },
];

const BOOK: Record<AdminFamily["book"]["status"], { label: string; tone: "ok" | "near" | "over" | "off" | "info" }> = {
  none: { label: "нет книги", tone: "off" },
  draft: { label: "черновик", tone: "info" },
  building: { label: "собирается", tone: "near" },
  ready: { label: "готова", tone: "ok" },
  failed: { label: "ошибка сборки", tone: "over" },
};

const date = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

const link = "flex min-h-12 items-center rounded-button border border-line bg-paper px-4 text-sm";

function href(view: SourceView, hideDemo: boolean): string {
  const q = new URLSearchParams();
  if (view !== "all") q.set("source", view);
  if (hideDemo) q.set("demo", "hide");
  const s = q.toString();
  return `/admin/families${s ? `?${s}` : ""}`;
}

function FamilyRow({ f }: { f: AdminFamily }) {
  const b = BOOK[f.book.status];
  return (
    <li className="flex flex-col gap-2 rounded-card border border-line bg-paper p-3" data-family={f.id}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 truncate font-medium">{f.name}</p>
        <Badge tone={b.tone}>
          книга: {b.label}
          {f.book.pages ? `, ${f.book.pages} стр.` : ""}
        </Badge>
      </div>
      <p className="flex flex-wrap gap-x-3 text-sm text-ink-soft">
        <span>{f.source === "kiosk" ? "киоск АКНЦ" : "сами (/start)"}</span>
        {f.isDemo ? <span className="text-warning">демо</span> : null}
        <span className="font-mono text-muted">{f.shortId}</span>
        <span className="text-muted">создана {date(f.createdAt)}</span>
      </p>
      <p className="flex flex-wrap gap-x-3 text-sm">
        <span>
          главы: <b>{f.chapters.ready}</b> готово / {f.chapters.total} всего
        </span>
        {f.chapters.failed > 0 ? <span className="text-danger">⚠ ошибка {f.chapters.failed}</span> : null}
        {f.aiUsd > 0 ? <span className="text-ink-soft">ИИ {fmtUsd(f.aiUsd)}</span> : null}
      </p>
      <p className="text-sm">
        <span className="text-muted">Цена книги: </span>
        {f.price ? (
          <>
            <b>{priceLabel(f.price)}</b> <span className="text-muted">· {f.price.status}</span>
          </>
        ) : (
          <span className="text-muted">не выбран</span>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <a className={link} href={f.links.family}>
          Семья и главы
        </a>
        <a className={link} href={f.links.book}>
          Книга
        </a>
        <a className={link} href={f.links.names}>
          Словарь имён
        </a>
      </div>
    </li>
  );
}

export default async function AdminFamiliesPage({ searchParams }: { searchParams: Search }) {
  if (!isAdminConfigured() || !(await isAdmin())) redirect("/admin");
  const sp = await searchParams;
  const view = (VIEWS.find((v) => v.view === sp.source)?.view ?? "all") as SourceView;
  const hideDemo = sp.demo === "hide";

  let all: AdminFamily[] | null = null;
  let memory = false;
  try {
    const r = await loadAdminFamilyRows();
    memory = r.source === "memory";
    all = buildAdminFamilies(r.rows);
  } catch (e) {
    console.error("[admin/families]", e instanceof Error ? e.message : e);
  }
  const list = all ? filterAdminFamilies(all, view, hideDemo) : [];
  const t = totals(list);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs tracking-widest text-muted uppercase">Книга семьи · админка</p>
          <h1 className="font-serif text-2xl">Семьи</h1>
        </div>
        <nav className="flex gap-2 text-sm" aria-label="Разделы админки">
          <Link href="/admin" className={link}>
            Пульт
          </Link>
          <Link href="/admin/ai" className={link}>
            ИИ
          </Link>
        </nav>
      </header>

      <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label="Источник семьи">
        {VIEWS.map((v) => (
          <Link
            key={v.view}
            href={href(v.view, hideDemo)}
            aria-current={v.view === view ? "page" : undefined}
            className={`flex min-h-12 items-center rounded-button border px-4 ${v.view === view ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink"}`}
          >
            {v.label}
          </Link>
        ))}
        <Link href={href(view, !hideDemo)} className="ml-auto flex min-h-12 items-center rounded-button border border-line bg-paper px-4 text-ink-soft">
          {hideDemo ? "☑ демо скрыты" : "☐ скрыть демо"}
        </Link>
      </nav>

      <Notice tone="info">
        Только для команды: ссылки ниже содержат ключ семьи — не пересылайте их и не вставляйте в чаты, логи и PR. Кабинет центра (/center) видит
        только семьи киоска.
      </Notice>
      {memory ? <Notice tone="info">База не настроена — показана память сервера (локальный режим).</Notice> : null}
      {!all ? <Notice tone="err">Не удалось прочитать семьи. Обновите страницу через минуту.</Notice> : null}

      {all ? (
        <section className="rounded-card bg-paper-deep p-4 text-sm shadow-card">
          <p>
            Семей: <b>{t.families}</b> (сами {t.family} · киоск {t.kiosk}) · готовых глав: {t.readyChapters}
          </p>
          <p>
            С выбранным тарифом: {t.withOrder} · сумма заказов: <b>{formatKzt(t.ordersKzt)}</b> <span className="text-muted">(демо, денег нет)</span>
            {t.aiUsd > 0 ? ` · ИИ ${fmtUsd(t.aiUsd)}` : ""}
          </p>
        </section>
      ) : null}

      {all && list.length === 0 ? <p className="rounded-card bg-paper-deep p-5 text-center text-ink-soft">Семей пока нет.</p> : null}
      {list.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {list.map((f) => (
            <FamilyRow key={f.id} f={f} />
          ))}
        </ul>
      ) : null}
    </main>
  );
}
