import Link from "next/link";
import type { ReactNode } from "react";
import { LogoutButton } from "./LogoutButton";
import { centerHref } from "./ui";

type Tab = "home" | "families" | "archive" | "volunteers";

const TABS: { tab: Tab; href: string; label: string }[] = [
  { tab: "home", href: "/center", label: "Сводка" },
  { tab: "families", href: "/center/families", label: "Семьи" },
  { tab: "archive", href: "/center/archive", label: "Архив АКНЦ" },
  { tab: "volunteers", href: "/center/volunteers", label: "Волонтёры" },
];

// Каркас кабинета АКНЦ: заголовок, вкладки, фильтр демо-семей (сохраняется между вкладками).
export function CenterShell({
  title,
  tab,
  hideDemo = false,
  signedIn = true,
  demoToggle = true,
  children,
}: {
  title: string;
  tab?: Tab;
  hideDemo?: boolean;
  signedIn?: boolean;
  demoToggle?: boolean;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs tracking-widest text-muted uppercase">АКНЦ · 알마티 고려인 센터</p>
          <h1 className="font-serif text-2xl">{title}</h1>
        </div>
        {signedIn ? <LogoutButton /> : null}
      </header>
      {signedIn && tab ? (
        <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label="Разделы кабинета">
          {TABS.map((t) => (
            <Link
              key={t.tab}
              href={centerHref(t.href, hideDemo)}
              aria-current={t.tab === tab ? "page" : undefined}
              className={`flex min-h-12 items-center rounded-button border px-4 ${
                t.tab === tab ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink"
              }`}
            >
              {t.label}
            </Link>
          ))}
          {demoToggle ? (
            <Link
              href={centerHref(TABS.find((t) => t.tab === tab)!.href, !hideDemo)}
              className="ml-auto flex min-h-12 items-center rounded-button border border-line bg-paper px-4 text-ink-soft"
            >
              {hideDemo ? "☑ демо скрыты" : "☐ скрыть демо"}
            </Link>
          ) : null}
        </nav>
      ) : null}
      {children}
    </main>
  );
}
