// #352: вкладка контура качества, которой ещё нет, — «скоро». Своя страница вкладки (app/admin/quality/<вкладка>/page.tsx)
// перекрывает этот маршрут сама — его не нужно менять.
import { notFound } from "next/navigation";
import { Notice, Section } from "@/components/admin/ui";
import { SOON_TABS } from "../_lib/tabs";

export const dynamic = "force-dynamic";

export default async function QualitySoonTab({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params;
  const t = SOON_TABS[tab];
  if (!t) notFound();
  return (
    <Section title={t.label} hint={`Скоро (${t.issue}).`}>
      <Notice tone="info">Скоро: {t.what}. Банк проверок для неё уже собирается — вкладка «Банк».</Notice>
    </Section>
  );
}
