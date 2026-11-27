// /admin/families — наша админка «Семьи» (#201): все семьи (family и kiosk), источник, главы готово / всего,
// статус книги, цена книги (тариф + допы из demo_orders), расход ИИ, ссылки на семью, книгу и словарь имён.
// Вход — наш ADMIN_PIN (cookie та же, что у /admin и /admin/ai). Токены семей — только в ссылках этой страницы.
// #223: флаги функций — список с описанием и где включены; у семьи — переключатели families.labs.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Badge, fmtUsd, Notice } from "@/components/admin/ui";
import { env } from "@/lib/env";
import { currentEnvFlags, flag, FLAG_NAMES, FLAGS, isFlagName, type FlagName } from "@/lib/flags";
import { formatKzt } from "@/lib/payments/plans";
import { isAdmin, isAdminConfigured } from "../ai/_lib/session";
import { buildAdminFamilies, filterAdminFamilies, labsCount, priceLabel, totals, type AdminFamily, type SourceView } from "./_lib/families";
import { loadAdminFamilyRows, setFamilyLab } from "./_lib/load";

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

const ISSUES = "https://github.com/prokodan/kniga-semyi/issues";

/** Куда вернуться после переключения: только эта страница (с её фильтрами), без чужих адресов. */
function backTo(raw: FormDataEntryValue | null, kind: "ok" | "err", message: string): never {
  const path = typeof raw === "string" && /^\/admin\/families(\?[^#]*)?$/.test(raw) ? raw : "/admin/families";
  const u = new URL(path, "http://x");
  u.searchParams.delete("ok");
  u.searchParams.delete("err");
  u.searchParams.set(kind, message);
  redirect(`${u.pathname}${u.search}`);
}

async function toggleLabAction(fd: FormData) {
  "use server";
  const ret = fd.get("return");
  if (!(await isAdmin())) backTo(ret, "err", "Сессия истекла — введите PIN ещё раз в /admin.");
  const familyId = String(fd.get("family") ?? "");
  const name = String(fd.get("flag") ?? "");
  const on = fd.get("on") === "1";
  if (!familyId || !isFlagName(name)) backTo(ret, "err", "Неизвестный флаг или семья.");
  let message: string;
  try {
    await setFamilyLab(familyId, name, on);
    message = `${name}: ${on ? "включён" : "выключен"} семье ${familyId.slice(0, 8)}`;
  } catch (e) {
    console.error("[admin/families] labs:", e instanceof Error ? e.message : e);
    backTo(ret, "err", `Не удалось изменить флаг: ${e instanceof Error ? e.message : String(e)}`);
  }
  revalidatePath("/admin/families");
  backTo(ret, "ok", message);
}

function envLabel(name: FlagName): { text: string; tone: "ok" | "off" } {
  const e = currentEnvFlags();
  if (FLAGS[name].everyone) return { text: "включён всем (everyone)", tone: "ok" };
  if (e.all || e.names.has(name)) return { text: e.source === "FLAGS_ON" ? "включён окружением (FLAGS_ON)" : "включён окружением (по умолчанию не в проде)", tone: "ok" };
  return { text: "в окружении выключен — только семьи из labs", tone: "off" };
}

function FlagsSection({ counts }: { counts: Map<string, number> }) {
  return (
    <section className="flex flex-col gap-2 rounded-card bg-paper-deep p-4 text-sm shadow-card" aria-label="Флаги функций">
      <h2 className="font-serif text-lg">Флаги функций</h2>
      <p className="text-ink-soft">
        Окружение: <b>{env.vercelEnv()}</b>. Семье флаг включается кнопкой в её карточке (families.labs) — даже если в
        окружении он выключен. Как выкатывать — docs/HANDOFF.md §3 «Флаги».
      </p>
      <ul className="flex flex-col gap-2">
        {FLAG_NAMES.map((n) => {
          const info = FLAGS[n];
          const e = envLabel(n);
          return (
            <li key={n} className="flex flex-col gap-1 rounded-card border border-line bg-paper p-3" data-flag={n}>
              <p className="flex flex-wrap items-center gap-2">
                <code className="font-mono">{n}</code>
                <Badge tone={e.tone}>{e.text}</Badge>
              </p>
              <p>{info.description}</p>
              <p className="text-muted">
                семей с флагом: {counts.get(n) ?? 0} · ведёт {info.owner} ·{" "}
                <a className="underline" href={`${ISSUES}/${info.issue}`}>
                  #{info.issue}
                </a>
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function LabToggles({ f, returnTo }: { f: AdminFamily; returnTo: string }) {
  if (FLAG_NAMES.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {FLAG_NAMES.map((n) => {
        const on = f.labs.includes(n);
        return (
          <form key={n} action={toggleLabAction}>
            <input type="hidden" name="family" value={f.id} />
            <input type="hidden" name="flag" value={n} />
            <input type="hidden" name="on" value={on ? "0" : "1"} />
            <input type="hidden" name="return" value={returnTo} />
            <button
              type="submit"
              className={`flex min-h-12 items-center rounded-button border px-4 text-sm ${on ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink"}`}
            >
              {on ? `✓ ${n} — выключить семье` : `${n} — включить семье`}
            </button>
          </form>
        );
      })}
    </div>
  );
}

function FamilyRow({ f, returnTo }: { f: AdminFamily; returnTo: string }) {
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
        {/* #223: демонстрационный флаг — единственное, что он делает */}
        {flag("demo_flag", { familyId: f.id, labs: f.labs }) ? <span title="demo_flag включён">🧪</span> : null}
      </p>
      {f.labs.length > 0 ? <p className="text-sm text-ink-soft">labs: {f.labs.join(", ")}</p> : null}
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
      <LabToggles f={f} returnTo={returnTo} />
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
  const returnTo = href(view, hideDemo);
  const ok = typeof sp.ok === "string" ? sp.ok : null;
  const err = typeof sp.err === "string" ? sp.err : null;

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
      {ok ? <Notice tone="ok">{ok}</Notice> : null}
      {err ? <Notice tone="err">{err}</Notice> : null}
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

      {all ? <FlagsSection counts={labsCount(all)} /> : null}

      {all && list.length === 0 ? <p className="rounded-card bg-paper-deep p-5 text-center text-ink-soft">Семей пока нет.</p> : null}
      {list.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {list.map((f) => (
            <FamilyRow key={f.id} f={f} returnTo={returnTo} />
          ))}
        </ul>
      ) : null}
    </main>
  );
}
