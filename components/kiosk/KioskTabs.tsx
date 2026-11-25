import Link from "next/link";

// #200: вкладки киоска — «Очередь дня» (запись) и «Архив» (публичный экран центра).
const TABS = [
  { href: "/kiosk/queue", label: "Очередь дня" },
  { href: "/kiosk/archive", label: "Архив" },
] as const;

export function KioskTabs({ current }: { current: (typeof TABS)[number]["href"] }) {
  return (
    <nav aria-label="Разделы киоска" className="flex gap-2 rounded-button bg-paper-deep p-1">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.href === current ? "page" : undefined}
          className={`inline-flex min-h-12 flex-1 items-center justify-center rounded-button px-4 text-elder sm:flex-none ${
            t.href === current ? "bg-ink text-paper" : "text-ink-soft active:bg-paper"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
