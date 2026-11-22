// Счётчики и карточки семей кабинета АКНЦ. Серверные компоненты, только токены из globals.css.
import { Badge } from "@/components/admin/ui";
import { BOOK_LABEL, BOOK_STATUSES, type CenterCounters, type CenterFamily, type Counter, type FamilyBookStatus } from "@/app/api/center/_lib/stats";

const fmt = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 1 });

function Tile({ label, value, today, unit }: { label: string; value: number; today?: number; unit?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-card border border-line bg-paper p-3">
      <span className="text-sm text-muted">{label}</span>
      <span className="font-serif text-3xl leading-none">
        {fmt(value)}
        {unit ? <span className="ml-1 text-base text-ink-soft">{unit}</span> : null}
      </span>
      {today !== undefined ? <span className={`text-sm ${today > 0 ? "text-success" : "text-muted"}`}>сегодня +{fmt(today)}</span> : null}
    </div>
  );
}

const t = (c: Counter) => ({ value: c.total, today: c.today });

export const BOOK_TONE: Record<FamilyBookStatus, "ok" | "near" | "over" | "off" | "info"> = {
  none: "off",
  draft: "info",
  building: "near",
  ready: "ok",
  failed: "over",
};

export function CountersGrid({ c }: { c: CenterCounters }) {
  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-card bg-paper-deep p-4 shadow-card">
        <h2 className="font-serif text-xl">Голос общины</h2>
        <p className="mt-1 text-sm text-muted">Всего и за сегодня (с полуночи по Алматы)</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Tile label="Минут голоса сохранено" {...t(c.minutes)} unit="мин" />
          <Tile label="Старейшин записано" {...t(c.elders)} />
          <Tile label="Историй" {...t(c.stories)} />
          <Tile label="Глав готово" {...t(c.readyStories)} />
          <Tile label="Семей" {...t(c.families)} />
          <Tile label="Из них через киоск" {...t(c.kioskFamilies)} />
        </div>
        <p className="mt-3 text-sm text-ink-soft">
          Голосовое согласие: {c.consented} из {c.elders.total} · в архив АКНЦ согласились {c.archive} {c.archive === 1 ? "семья" : "семей"}
        </p>
      </section>
      <section className="rounded-card bg-paper-deep p-4 shadow-card">
        <h2 className="font-serif text-xl">Книги</h2>
        <p className="mt-1 text-sm text-muted">Статус последней книги каждой семьи · собрано сегодня: {c.booksBuiltToday}</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {BOOK_STATUSES.map((s) => (
            <li key={s}>
              <Badge tone={BOOK_TONE[s]}>
                {BOOK_LABEL[s]}: {c.books[s]}
              </Badge>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

const date = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export function FamilyCard({ f, bookHref }: { f: CenterFamily; bookHref?: string }) {
  const s = f.stories;
  return (
    <li className="flex flex-col gap-2 rounded-card border border-line bg-paper p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 truncate font-medium">{f.name}</p>
        <Badge tone={BOOK_TONE[f.book]}>книга: {BOOK_LABEL[f.book]}</Badge>
      </div>
      <p className="flex flex-wrap gap-x-3 text-sm text-ink-soft">
        <span>{f.source === "kiosk" ? "киоск АКНЦ" : "семья сама"}</span>
        {f.archive ? <span className="text-jade">✓ архив АКНЦ</span> : null}
        {f.isDemo ? <span className="text-warning">демо</span> : null}
        <span className="text-muted">{date(f.lastAt)}</span>
      </p>
      <p className="text-sm">
        {f.storytellers.length === 0
          ? "рассказчик не указан"
          : f.storytellers.map((st, i) => (
              <span key={i} className="mr-3">
                {st.name}
                {st.birthYear ? `, ${st.birthYear}` : ""}
                <span className={st.consent ? "text-success" : "text-warning"}>{st.consent ? " ✓ согласие" : " · нет согласия"}</span>
              </span>
            ))}
      </p>
      <p className="flex flex-wrap gap-x-3 text-sm">
        {s.total === 0 ? (
          <span className="text-muted">историй пока нет</span>
        ) : (
          <>
            <span>историй: {s.total}</span>
            {s.ready > 0 && <span className="text-success">✓ готово {s.ready}</span>}
            {s.working > 0 && <span className="text-warning">⏳ в работе {s.working}</span>}
            {s.failed > 0 && <span className="text-danger">⚠ ошибка {s.failed}</span>}
            <span className="text-ink-soft">{fmt(f.minutes)} мин голоса</span>
          </>
        )}
      </p>
      {bookHref ? (
        <div className="flex flex-wrap gap-2">
          <a href={bookHref} className="flex min-h-12 items-center rounded-button bg-seal px-5 font-semibold text-paper active:bg-seal-dark">
            Открыть книгу
          </a>
          <a href={`/center/archive#f-${f.id}`} className="flex min-h-12 items-center rounded-button border border-line px-4 text-ink">
            Главы и голос →
          </a>
        </div>
      ) : null}
    </li>
  );
}
