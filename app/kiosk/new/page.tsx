import Link from "next/link";
import { ElderForm } from "@/components/kiosk/ElderForm";
import { kGhost } from "@/components/kiosk/ui";
import { currentVolunteerId, requireKiosk } from "@/app/api/kiosk/_lib/session";
import { getKioskStore } from "@/app/api/kiosk/_lib/store";

export const dynamic = "force-dynamic";

// /kiosk/new — карточка старейшины: имя, годы, фото с камеры планшета, волонтёр из kiosk_volunteers.
export default async function KioskNewPage() {
  await requireKiosk();
  const [volunteers, current] = await Promise.all([getKioskStore().listVolunteers(), currentVolunteerId()]);
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-6">
      <header className="flex items-center justify-between gap-6">
        <h1 className="font-serif text-4xl">Новый старейшина</h1>
        <Link href="/kiosk/queue" className={kGhost}>
          ← Очередь дня
        </Link>
      </header>
      <ElderForm volunteers={volunteers.map((v) => ({ id: v.id, name: v.name }))} currentVolunteerId={current} />
    </main>
  );
}
