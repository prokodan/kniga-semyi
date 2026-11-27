import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFamilyByToken } from "@/lib/db/access";
import { photoUrls } from "@/lib/db/photos";
import { flag } from "@/lib/flags";
import { effectiveBookLangs } from "@/lib/pipeline/langs";
import { loadTree } from "@/lib/tree";
import { rowLang } from "@/lib/tree/rows";
import { LinkNotFound } from "../../../_ui/LinkNotFound";
import { TreeView } from "./TreeView";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Древо семьи · Книга семьи", robots: { index: false, follow: false } };

// /f/<токен>/tree — древо семьи (#235 → #277 древо 2.0, флаг family_tree). Строится само из глав (словарь имён + родство из рассказов,
// без ИИ), правится здесь. На древе — книга рассказчика и «Записать историю мамы» (вторая книга в семье).
export default async function TreePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ book?: string; open?: string; focus?: string }>;
}) {
  const { token } = await params;
  const { book, open, focus } = await searchParams;
  const view = await getFamilyByToken(token);
  if (!view) return <LinkNotFound />;
  const { family, storytellers, stories } = view;
  if (!flag("family_tree", { familyId: family.id, labs: family.labs })) notFound();

  const viewer = storytellers.find((s) => s.id === book)?.id ?? storytellers[0]?.id ?? null;
  // #277: большие семьи — ветки «сбоку» свёрнуты; ?open=<id>,<id> — развёрнутые, ?open=all — все
  const opened = open === "all" ? "all" : (open ?? "").split(",").filter((x) => /^[0-9a-f-]{8,40}$/i.test(x)).slice(0, 50);
  const { model } = await loadTree(family.id, { write: true, viewer, layout: { collapse: { open: opened } } });

  const everyone = [...model.nodes, ...model.hidden, ...model.others];
  const urls = await photoUrls(everyone.map((n) => n.photo)).catch(() => ({}) as Record<string, string>);
  const photos: Record<string, string> = {};
  for (const n of everyone) {
    const url = n.photo ? urls[n.photo] : undefined;
    if (url) photos[n.id] = url;
  }

  const titles = new Map(stories.map((s) => [s.id, s.title?.trim() || "Глава без названия"]));
  const chapterTitles: Record<string, string> = {};
  for (const n of everyone) for (const id of n.storyIds) if (titles.has(id)) chapterTitles[id] = titles.get(id)!;

  const langs = effectiveBookLangs(family, flag("lang_kk", { familyId: family.id, labs: family.labs }));
  const showKo = langs.includes("ko");

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-5 px-5 py-8">
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
          Древо складывается само из рассказов. Нажмите на человека — имя, годы, фото, главы, где его вспоминают. Двумя пальцами — крупнее или мельче.
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
        rowLang={rowLang(langs)}
        storytellers={storytellers.map((s) => ({ id: s.id, name: s.name }))}
        chapterTitles={chapterTitles}
        book={book && viewer === book ? book : null}
        opened={opened}
        focusId={focus && everyone.some((n) => n.id === focus) ? focus : null}
      />
    </main>
  );
}
