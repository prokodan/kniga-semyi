import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loadChapter } from "@/lib/book/chapter";
import { AdditionBanner } from "@/components/chapter/AdditionBanner";
import { DraftEditor } from "@/components/draft/DraftEditor";
import { familyBookLangsById } from "@/lib/pipeline/book-langs";
import { langUi } from "@/lib/pipeline/langs";
import { LinkNotFound } from "../../_ui/LinkNotFound";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Правка главы · Книга семьи", robots: { index: false, follow: false } };

// Правка черновика /draft/<storyId>?token=<токен семьи>: заголовок, цитата, текст RU.
// После сохранения перевод (второй язык книги) пересобирается сам (PATCH /api/stories/:id/edit).
// #299 / #245: текст RU — из story_texts (loadChapter), подпись про перевод — по языкам книги семьи.
export default async function DraftPage({
  params,
  searchParams,
}: {
  params: Promise<{ storyId: string }>;
  searchParams: Promise<{ token?: string; t?: string }>;
}) {
  const { storyId } = await params;
  const sp = await searchParams;
  const token = sp.token ?? sp.t;
  if (!token) return <LinkNotFound />;

  const data = await loadChapter(storyId, { token });
  if (!data) return <LinkNotFound />;
  const { story, family } = data;
  if (story.parent_story_id) redirect(`/draft/${story.parent_story_id}?token=${encodeURIComponent(token)}`);

  const chapterUrl = `/chapter/${story.id}?token=${encodeURIComponent(token)}`;
  const editable = Boolean(story.text_ru) && story.status !== "transcribing" && story.status !== "editing";
  const ui = langUi(await familyBookLangsById(story.family_id));

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 md:px-8 md:py-10">
      <nav className="flex items-center justify-between gap-4">
        <Link href={chapterUrl} className="inline-flex min-h-12 items-center text-ink-soft underline-offset-4 hover:underline">
          ← К главе
        </Link>
        <Link href={`/f/${token}`} className="inline-flex min-h-12 items-center text-sm text-muted underline-offset-4 hover:underline">
          {family.name}
        </Link>
      </nav>

      <header className="flex flex-col gap-2">
        <h1 className="font-serif text-3xl leading-tight">Исправить главу</h1>
        <p className="text-elder text-ink-soft">
          {`ИИ мог ошибиться в именах, названиях мест и датах. Поправьте их здесь${ui ? ` — ${ui.name} перевод обновится сам.` : "."}`}
        </p>
      </header>

      <AdditionBanner story={story} token={token} place="draft" />

      {editable ? (
        <DraftEditor
          storyId={story.id}
          token={token}
          chapterUrl={chapterUrl}
          initial={{ title: story.title ?? "", quote: story.quote ?? "", text_ru: story.text_ru ?? "" }}
          sources={[story.transcript ?? ""].filter(Boolean)}
        />
      ) : (
        <section className="flex flex-col gap-4 rounded-card bg-paper-deep p-6 shadow-card">
          <p className="text-elder">Глава ещё собирается. Как только она будет готова, здесь можно будет поправить текст.</p>
          <Link href={chapterUrl} className="button rounded-button bg-seal px-6 py-4 text-center text-lg font-semibold text-paper">
            Открыть главу
          </Link>
        </section>
      )}
    </main>
  );
}
