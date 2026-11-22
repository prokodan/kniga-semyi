import { redirect } from "next/navigation";
import { PinForm } from "@/components/kiosk/PinForm";
import { isKiosk, isKioskConfigured } from "@/app/api/kiosk/_lib/session";

export const dynamic = "force-dynamic";

// /kiosk — вход волонтёра по PIN (KIOSK_PIN, проверка на сервере, cookie до конца дня).
export default async function KioskPinPage() {
  if (await isKiosk()) redirect("/kiosk/queue");
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col items-center justify-center gap-8 px-8 text-center">
      <div className="flex flex-col gap-2">
        <p className="tracking-widest text-muted uppercase">АКНЦ · 알마티 고려인 민족 센터</p>
        <h1 className="font-serif text-5xl">Книга семьи</h1>
        <p className="text-ink-soft" lang="ko">
          가족의 책
        </p>
      </div>
      {isKioskConfigured() ? (
        <PinForm />
      ) : (
        <p className="rounded-card bg-paper-deep p-6 text-ink-soft">Киоск пока выключен: администратору нужно задать KIOSK_PIN.</p>
      )}
    </main>
  );
}
