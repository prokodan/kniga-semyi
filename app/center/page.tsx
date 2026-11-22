// /center — кабинет АКНЦ (I9): вход по ADMIN_PIN (проверка на сервере), счётчики «всего / сегодня».
import type { Metadata } from "next";
import { Notice } from "@/components/admin/ui";
import { PinForm } from "@/components/center/PinForm";
import { CountersGrid } from "@/components/center/Readouts";
import { CenterShell } from "@/components/center/Shell";
import { isCenterAdmin, isCenterConfigured, loadCenter, type CenterData } from "@/app/api/center/_lib/http";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Кабинет АКНЦ · Книга семьи", robots: { index: false, follow: false } };

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function CenterPage({ searchParams }: { searchParams: Search }) {
  if (!isCenterConfigured()) {
    return (
      <CenterShell title="Кабинет центра" signedIn={false}>
        <Notice tone="info">Кабинет выключен: задайте ADMIN_PIN в Vercel → Environment Variables и сделайте redeploy.</Notice>
      </CenterShell>
    );
  }
  if (!(await isCenterAdmin())) {
    return (
      <CenterShell title="Кабинет центра" signedIn={false}>
        <p className="text-ink-soft">Сколько старейшин записано, сколько минут голоса сохранено и какие книги готовы.</p>
        <PinForm />
      </CenterShell>
    );
  }

  const hideDemo = (await searchParams).demo === "hide";
  let data: CenterData | null = null;
  try {
    data = await loadCenter({ hideDemo });
  } catch (e) {
    console.error("[center]", e instanceof Error ? e.message : e);
  }

  return (
    <CenterShell title="Кабинет центра" tab="home" hideDemo={hideDemo}>
      {!data ? <Notice tone="err">Не удалось прочитать данные. Обновите страницу через минуту.</Notice> : null}
      {data?.source === "memory" ? <Notice tone="info">База не настроена — показана память сервера (локальный режим).</Notice> : null}
      {data ? <CountersGrid c={data.counters} /> : null}
    </CenterShell>
  );
}
