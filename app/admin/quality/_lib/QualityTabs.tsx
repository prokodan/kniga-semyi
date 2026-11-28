"use client";
// #352: полоса вкладок /admin/quality — активная по адресу.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { QUALITY_TABS, tabHref } from "./tabs";

export function QualityTabs() {
  const path = usePathname() ?? "/admin/quality";
  return (
    <nav className="flex gap-2 overflow-x-auto pb-1 text-sm" aria-label="Вкладки контура качества">
      {QUALITY_TABS.map((t) => {
        const href = tabHref(t.slug);
        const active = t.slug ? path.startsWith(href) : path === "/admin/quality";
        return (
          <Link
            key={t.label}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-12 shrink-0 items-center rounded-button border px-4 ${active ? "border-seal bg-seal text-paper" : "border-line bg-paper text-ink"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
