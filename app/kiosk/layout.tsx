import type { Metadata, Viewport } from "next";

// Киоск АКНЦ (Z5): планшет в центре, ландшафт, крупно. Не индексируется.
export const metadata: Metadata = { title: "Киоск АКНЦ · Книга семьи", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };

export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-paper text-elder text-ink">{children}</div>;
}
