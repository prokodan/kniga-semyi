import { ArchiveShow, type Slide } from "@/components/kiosk/ArchiveShow";
import { loadShow } from "@/app/api/kiosk/_lib/archive";
import { requireKiosk } from "@/app/api/kiosk/_lib/session";

export const dynamic = "force-dynamic";

// /kiosk/archive/show — «▶ Показ»: главы архива по очереди на весь экран, без меню киоска. Вход — тот же PIN киоска.
export default async function KioskArchiveShowPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  await requireKiosk();
  const { from } = await searchParams;
  const slides: Slide[] = (await loadShow()).flatMap((f) =>
    f.chapters.map((c) => ({
      ...c,
      storyteller: f.name,
      storytellerKo: f.nameKo,
      meta: [f.birthYear ? `${f.birthYear} г. р.` : null, f.birthPlace].filter(Boolean).join(" · "),
    })),
  );
  const start = Math.max(0, slides.findIndex((s) => s.id === from));
  return <ArchiveShow slides={slides} start={start} />;
}
