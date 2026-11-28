// #352 (docs/v2/QUALITY_LOOP.md §3): каркас /admin/quality — вход по ADMIN_PIN (cookie /admin), флаг quality_loop,
// шапка и вкладки (Банк · Проверки · Находки · Изменения · История). Вкладки других чатов — app/admin/quality/<вкладка>/*.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Notice } from "@/components/admin/ui";
import { flag } from "@/lib/flags";
import { isAdmin, isAdminConfigured } from "../ai/_lib/session";
import { QualityTabs } from "./_lib/QualityTabs";

export const metadata: Metadata = { title: "Качество · админка · Книга семьи", robots: { index: false, follow: false } };

const link = "flex min-h-12 items-center rounded-button border border-line bg-paper px-4 text-sm";

export default async function QualityLayout({ children }: { children: ReactNode }) {
  if (!isAdminConfigured() || !(await isAdmin())) redirect("/admin");
  const on = flag("quality_loop");
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-6 sm:px-6" data-testid="quality-page">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs tracking-widest text-muted uppercase">Книга семьи · админка</p>
          <h1 className="font-serif text-2xl">Контур качества</h1>
        </div>
        <nav className="flex gap-2 text-sm" aria-label="Разделы админки">
          <Link href="/admin" className={link}>
            Пульт
          </Link>
          <Link href="/admin/reviews" className={link}>
            Носители
          </Link>
        </nav>
      </header>
      {on ? (
        <>
          <QualityTabs />
          {children}
        </>
      ) : (
        <Notice tone="info">
          Контур качества выключен на этом окружении (флаг <b>quality_loop</b>). Он работает на staging:
          kniga-semyi-git-staging-kniga-semyi-team.vercel.app/admin/quality.
        </Notice>
      )}
    </main>
  );
}
