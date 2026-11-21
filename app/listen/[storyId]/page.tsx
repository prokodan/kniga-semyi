import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { audioSignedUrl, lifeYears, loadChapter, photoSignedUrl } from "@/lib/book/chapter";
import { verifyListen } from "@/lib/book/qr";
import { Quote } from "@/components/chapter/Quote";
import { VoicePlayer } from "@/components/chapter/VoicePlayer";

export const dynamic = "force-dynamic";

// Публичная страница голоса /listen/<storyId>?s=<подпись> — сюда ведёт QR главы и книги.
// Без токена семьи и без входа: подпись открывает только эту историю; неверная подпись → 404.
// Серверный рендер, из JS — только плеер: открывается быстро и на мобильном интернете.
type Props = { params: Promise<{ storyId: string }>; searchParams: Promise<{ s?: string }> };

const load = cache(async (storyId: string, sig: string | undefined) => {
  if (!verifyListen(storyId, sig)) return null;
  const data = await loadChapter(storyId);
  if (!data || data.story.parent_story_id) return null;
  return data;
});

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ storyId }, { s }] = await Promise.all([params, searchParams]);
  const data = await load(storyId, s);
  if (!data) return { title: "Книга семьи", robots: { index: false, follow: false } };
  const name = data.storyteller?.name ?? "Голос семьи";
  const title = data.story.title ? `${name} — «${data.story.title}»` : name;
  const description = data.story.quote ?? "Живой голос из «Книги семьи» · 우리 이야기";
  return {
    title: `${title} · Книга семьи`,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, type: "music.song", siteName: "Книга семьи · 우리 이야기" },
  };
}

export default async function ListenPage({ params, searchParams }: Props) {
  const [{ storyId }, { s }] = await Promise.all([params, searchParams]);
  const data = await load(storyId, s);
  if (!data) notFound();

  const { story, storyteller } = data;
  const [audio, photo] = await Promise.all([audioSignedUrl(story.audio_url), photoSignedUrl(storyteller?.photo_url ?? null, 12 * 60 * 60)]);
  const name = storyteller?.name ?? "Рассказчик";
  const meta = [lifeYears(storyteller), storyteller?.birth_place].filter(Boolean).join(" · ");

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center gap-7 px-6 pt-10 pb-12 text-center">
      <p className="text-xs tracking-[0.25em] text-muted uppercase">
        Книга семьи · <span lang="ko">우리 이야기</span>
      </p>

      <div className="flex flex-col items-center gap-3">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- подписанная ссылка Storage
          <img src={photo} alt={name} width={144} height={144} fetchPriority="high" className="size-36 rounded-full object-cover shadow-card ring-4 ring-paper-deep" />
        ) : (
          <div aria-hidden className="flex size-36 items-center justify-center rounded-full bg-paper-deep font-serif text-5xl text-muted shadow-card">
            {name.slice(0, 1)}
          </div>
        )}
        <div>
          <h1 className="font-serif text-3xl leading-tight">{name}</h1>
          {storyteller?.name_ko && (
            <p className="font-serif text-xl text-ink-soft" lang="ko">
              {storyteller.name_ko}
            </p>
          )}
          {meta && <p className="mt-1 text-sm text-muted">{meta}</p>}
        </div>
      </div>

      {(story.title || story.title_ko) && (
        <div className="flex flex-col gap-1">
          {story.title && <h2 className="font-serif text-2xl leading-snug">«{story.title}»</h2>}
          {story.title_ko && (
            <p className="font-serif text-lg break-keep text-ink-soft" lang="ko">
              {story.title_ko}
            </p>
          )}
        </div>
      )}

      {audio ? (
        <VoicePlayer src={audio} durationHint={story.duration_sec} />
      ) : (
        <p className="rounded-card bg-paper-deep px-5 py-4 text-ink-soft">Запись скоро появится здесь.</p>
      )}

      {(story.quote || story.quote_ko) && (
        <div className="flex w-full flex-col gap-4 text-left">
          <Quote text={story.quote} lang="ru" size="md" />
          <Quote text={story.quote_ko} lang="ko" size="md" />
        </div>
      )}

      <footer className="mt-auto pt-4 text-sm text-muted">
        Голос записан семьёй для книги внукам.
        <br />
        <span lang="ko">손주들을 위한 가족의 이야기</span>
      </footer>
    </main>
  );
}
