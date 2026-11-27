import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFamilyByToken, getFamilyStore } from "@/lib/db/access";
import { flag } from "@/lib/flags";
import { loadTree } from "@/lib/tree";
import { LinkNotFound } from "../../../_ui/LinkNotFound";
import { TreeView } from "./TreeView";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Древо семьи · Книга семьи", robots: { index: false, follow: false } };

// /f/<токен>/tree — древо семьи (#235, флаг family_tree). Строится само из глав (словарь имён + родство из рассказов,
// без ИИ), правится здесь. На древе — книга рассказчика и «Записать историю мамы» (вторая книга в семье).
export default async function TreePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ book?: string }> }) {
  const { token } = await params;
  const { book } = await searchParams;
  const view = await getFamilyByToken(token);
  if (!view) return <LinkNotFound />;
  const { family, storytellers } = view;
  if (!flag("family_tree", { familyId: family.id, labs: family.labs })) notFound();

  const viewer = storytellers.find((s) => s.id === book)?.id ?? storytellers[0]?.id ?? null;
  const { model } = await loadTree(family.id, { write: true, viewer });

  const store = getFamilyStore();
  const photos: Record<string, string> = {};
  for (const n of model.nodes) {
    const st = storytellers.find((s) => s.id === n.storytellerId);
    if (!st?.photo_url) continue;
    const url = await store.photoUrl(st.photo_url).catch(() => null);
    if (url) photos[n.id] = url;
  }
  const langs = family.book_langs ?? ["ru", "ko"];
  const showKo = langs.includes("ko");

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-8">
      <nav>
        <Link href={`/f/${token}`} className="inline-flex min-h-12 items-center text-ink-soft underline-offset-4 hover:underline">
          ← {family.name}
        </Link>
      </nav>

      <header className="flex max-w-xl flex-col gap-2">
        <p className="text-sm tracking-widest text-muted uppercase">
          Книга семьи{showKo && <span lang="ko"> · 우리 이야기</span>}
        </p>
        <h1 className="font-serif text-3xl leading-tight">
          Древо семьи{showKo && <span className="text-ink-soft" lang="ko"> · 가계도</span>}
        </h1>
        <p className="text-ink-soft">
          Древо складывается само из рассказов: кого называли мамой, братом, женой. Нажмите на человека — можно вписать имя и годы,
          поправить место или записать его историю.
        </p>
      </header>

      {storytellers.length > 1 && (
        <div className="flex flex-wrap items-center gap-2" aria-label="Чья книга">
          <span className="text-sm text-muted">Родство от:</span>
          {storytellers.map((s) => (
            <Link
              key={s.id}
              href={`/f/${token}/tree?book=${s.id}`}
              aria-current={s.id === viewer ? "page" : undefined}
              className={`inline-flex min-h-12 items-center rounded-button border px-4 ${s.id === viewer ? "border-ink bg-paper-deep font-semibold" : "border-line bg-paper text-ink-soft"}`}
            >
              {s.name}
            </Link>
          ))}
        </div>
      )}

      <TreeView
        token={token}
        familyName={family.name}
        model={model}
        photos={photos}
        showKo={showKo}
        storytellers={storytellers.map((s) => ({ id: s.id, name: s.name }))}
      />
    </main>
  );
}
