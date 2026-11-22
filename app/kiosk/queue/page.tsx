import Link from "next/link";
import { LogoutButton } from "@/components/kiosk/LogoutButton";
import { QueueAutoRefresh } from "@/components/kiosk/QueueAutoRefresh";
import { kGhost, kPrimary } from "@/components/kiosk/ui";
import { kioskDayStart } from "@/app/api/kiosk/_lib/pin";
import { currentVolunteerId, requireKiosk } from "@/app/api/kiosk/_lib/session";
import { getKioskStore, type QueueItem } from "@/app/api/kiosk/_lib/store";

export const dynamic = "force-dynamic";

const time = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Almaty" });

function StoriesBadge({ s }: { s: QueueItem["stories"] }) {
  if (s.total === 0) return <span className="text-muted">рассказов пока нет</span>;
  return (
    <span className="flex flex-wrap gap-x-4">
      <span>рассказов: {s.total}</span>
      {s.ready > 0 && <span className="text-success">✓ готово {s.ready}</span>}
      {s.working > 0 && <span className="text-warning">⏳ в работе {s.working}</span>}
      {s.failed > 0 && <span className="text-danger">⚠ ошибка {s.failed}</span>}
    </span>
  );
}

// /kiosk/queue — очередь дня: старейшины за сегодня (Алматы), статусы историй. Обновляется сама.
export default async function KioskQueuePage() {
  await requireKiosk();
  const store = getKioskStore();
  const [items, volunteerId] = await Promise.all([store.queue(kioskDayStart()), currentVolunteerId()]);
  const volunteer = volunteerId ? await store.getVolunteer(volunteerId) : null;
  const today = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "long", timeZone: "Asia/Almaty" });

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-6">
      <QueueAutoRefresh />
      <header className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-4xl">Очередь дня</h1>
          <p className="text-muted">
            {today}
            {volunteer ? ` · волонтёр: ${volunteer.name}` : ""}
          </p>
        </div>
        <Link href="/kiosk/new" className={kPrimary}>
          + Новый старейшина
        </Link>
        <LogoutButton />
      </header>

      {items.length === 0 ? (
        <p className="rounded-card bg-paper-deep p-8 text-center text-ink-soft">
          Сегодня пока никого. Нажмите «Новый старейшина» — запись занимает около 15 минут.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((it) => (
            <li key={it.familyId} className="flex items-center gap-5 rounded-card bg-paper-deep p-4 shadow-card">
              {it.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- подписанная ссылка Storage на час
                <img src={it.photoUrl} alt="" className="size-20 shrink-0 rounded-card object-cover" />
              ) : (
                <div aria-hidden className="flex size-20 shrink-0 items-center justify-center rounded-card border border-dashed border-line text-4xl text-muted">
                  ☺
                </div>
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="truncate font-serif text-2xl">
                  {it.name}
                  {it.birthYear ? <span className="text-muted"> · {it.birthYear}</span> : null}
                </p>
                <p className="flex flex-wrap gap-x-4 text-base text-ink-soft">
                  <span>{time(it.lastAt)}</span>
                  <span className={it.consent ? "text-success" : "text-warning"}>{it.consent ? "✓ согласие" : "нет согласия"}</span>
                  <span>{it.archive ? "✓ в архив АКНЦ" : "без архива"}</span>
                  {it.volunteer && <span>волонтёр: {it.volunteer}</span>}
                </p>
                <div className="text-base">
                  <StoriesBadge s={it.stories} />
                </div>
              </div>
              <Link href={`/kiosk/session/${it.familyId}`} className={kGhost}>
                {it.stories.total > 0 ? "Продолжить" : "Начать"}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
