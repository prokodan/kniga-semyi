"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson, Recorder, uploadAudio, type Take } from "@/components/recorder";

export function ConsentRecorder({ token, storytellerId, already }: { token: string; storytellerId: string; already: boolean }) {
  const router = useRouter();
  const [done, setDone] = useState(already);

  async function send(take: Take, onProgress: (p: number) => void) {
    const path = await uploadAudio({ token, storytellerId, kind: "consent", take, onProgress });
    await postJson("/api/consent", token, { storytellerId, path });
    setDone(true);
    router.refresh();
  }

  if (done) {
    return (
      <div className="flex flex-col gap-3">
        <p className="rounded-card border border-success/40 bg-paper p-4 text-success">Согласие записано ✓ Спасибо!</p>
        <Link href={`/record/${token}`} className="button flex items-center justify-center rounded-button bg-seal px-6 py-4 text-elder font-semibold text-paper">
          Записать первый рассказ
        </Link>
        <Link href={`/f/${token}`} className="text-center text-ink-soft underline underline-offset-4">
          На страницу книги
        </Link>
      </div>
    );
  }

  return <Recorder maxSec={120} startLabel="Записать согласие" sendLabel="Сохранить согласие" onSend={send} />;
}
