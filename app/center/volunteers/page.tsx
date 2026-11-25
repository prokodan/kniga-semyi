// /center/volunteers — волонтёры киоска (kiosk_volunteers): список, добавление, отключение.
import type { Metadata } from "next";
import { Notice } from "@/components/admin/ui";
import { CenterShell } from "@/components/center/Shell";
import { VolunteersPanel } from "@/components/center/VolunteersPanel";
import { loadCenter, requireCenter, type CenterData } from "@/app/api/center/_lib/http";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Волонтёры · кабинет АКНЦ", robots: { index: false, follow: false } };

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function CenterVolunteersPage({ searchParams }: { searchParams: Search }) {
  await requireCenter();
  const hideDemo = (await searchParams).demo === "hide";
  let data: CenterData | null = null;
  try {
    data = await loadCenter({ hideDemo });
  } catch (e) {
    console.error("[center]", e instanceof Error ? e.message : e);
  }
  return (
    <CenterShell title="Волонтёры киоска" tab="volunteers" hideDemo={hideDemo} demoToggle={false}>
      <p className="text-sm text-ink-soft">Отключённый волонтёр пропадает из выбора на планшете, его записи остаются.</p>
      {data ? <VolunteersPanel volunteers={data.volunteers} /> : <Notice tone="err">Не удалось прочитать данные.</Notice>}
    </CenterShell>
  );
}
