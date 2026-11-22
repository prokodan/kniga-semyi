import { headers } from "next/headers";
import Link from "next/link";
import { KioskSession } from "@/components/kiosk/KioskSession";
import { kGhost } from "@/components/kiosk/ui";
import { consentText } from "@/app/(family)/consent/[token]/text";
import { currentVolunteerId, requireKiosk } from "@/app/api/kiosk/_lib/session";
import { getKioskStore } from "@/app/api/kiosk/_lib/store";
import { blockProgress } from "@/lib/db/access";
import { qrSvg } from "@/lib/book/qr";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

async function origin(): Promise<string> {
  const prod = env.prodUrl();
  if (prod) return prod.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

// /kiosk/session/<familyId> — согласие + запись по вопросам крупно. Только семьи киоска и только по PIN.
export default async function KioskSessionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireKiosk();
  const { id } = await params;
  const store = getKioskStore();
  const view = await store.getElder(id);
  if (!view || !view.storyteller) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-3xl flex-col items-center justify-center gap-6 px-8 text-center">
        <p className="font-serif text-4xl">Карточка не найдена</p>
        <Link href="/kiosk/queue" className={kGhost}>
          В очередь дня
        </Link>
      </main>
    );
  }
  const st = view.storyteller;
  const volunteerId = await currentVolunteerId();
  const volunteer = volunteerId ? await store.getVolunteer(volunteerId) : null;
  const mine = view.stories.filter((s) => s.storyteller_id === st.id && !s.parent_story_id);
  const familyUrl = `${await origin()}/f/${view.family.access_token}`;
  const svg = (await qrSvg(familyUrl)).replace(/aria-label="[^"]*"/, 'aria-label="QR-код: книга семьи"');

  return (
    <KioskSession
      token={view.family.access_token}
      familyId={view.family.id}
      storyteller={{ id: st.id, name: st.name, consented: Boolean(st.consent_at) }}
      archive={view.family.archive_consent}
      volunteerId={volunteer?.id ?? null}
      consentText={consentText(st.name)}
      initialCovered={blockProgress(view.stories, st.id).covered}
      answeredQuestionIds={[...new Set(mine.map((s) => s.question_id).filter((q): q is string => Boolean(q)))]}
      familyUrl={familyUrl}
      familyQrSvg={svg}
    />
  );
}
