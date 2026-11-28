import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BLOCKS } from "@/content/questions/blocks";
import { lifeYears, loadChapter, photoSignedUrl, requestOrigin } from "@/lib/book/chapter";
import { listenUrl } from "@/lib/book/qr";
import { familyBookLangsById } from "@/lib/pipeline/book-langs";
import { statusMessage } from "@/lib/pipeline/engine";
import { AdditionBanner } from "@/components/chapter/AdditionBanner";
import { QrCode } from "@/components/chapter/QrCode";
import { ShareButton } from "@/components/chapter/ShareButton";
import { Spread } from "@/components/chapter/Spread";
import { StoryWaiting } from "@/components/chapter/StoryWaiting";
import { LinkNotFound } from "../../_ui/LinkNotFound";
import { ExtraLang } from "./ExtraLang";
import { loadKkChapter } from "./kk";
import { SpreadKk } from "./SpreadKk";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Глава · Книга семьи", robots: { index: false, follow: false } };

// Разворот главы /chapter/<storyId>?token=<токен семьи>: RU | KR, фото, цитата крупно, QR на голос, «отправить семье».
// Текст — те же поля, что GET /api/stories/:id; пока история не ready — экран ожидания с опросом этой ручки.
// #274 (флаг lang_kk): книга RU + KZ → разворот RU | KZ (казахский — из story_texts); книга RU + KR — как было.
// #299: подписи (QR, шаги ожидания, «우리 이야기», имя по-корейски) — по языкам книги; только RU — без корейского.
export default async function ChapterPage({
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
  if (!data || data.story.status === "skipped") return <LinkNotFound />; // ответ-отказ — не глава
  const { story, storyteller, family } = data;

  // Ответ на уточнение — часть основной главы.
  if (story.parent_story_id) redirect(`/chapter/${story.parent_story_id}?token=${encodeURIComponent(token)}`);

  const [photo, origin, kk, langs] = await Promise.all([
    photoSignedUrl(storyteller?.photo_url ?? null),
    requestOrigin(),
    loadKkChapter(story, token),
    familyBookLangsById(story.family_id),
  ]);
  // #306: докупленный язык (третий в книге) — отдельной страницей под разворотом базовой пары; без него — как было
  const extra = langs.slice(2);
  const kkSpread = kk && !extra.includes("kk") ? kk : null;
  const ko = !kkSpread && langs.includes("ko") && !extra.includes("ko");
  const block = BLOCKS.find((b) => b.id === story.block);
  const ready = story.status === "ready";
  const voice = listenUrl(origin, story.id);
  const name = storyteller?.name ?? "Рассказчик";
  const meta = [lifeYears(storyteller), storyteller?.birth_place].filter(Boolean).join(" · ");

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-6 md:px-8 md:py-10">
      <nav className="flex items-center justify-between gap-4">
        <Link href={`/f/${token}`} className="inline-flex min-h-12 items-center text-ink-soft underline-offset-4 hover:underline">
          ← {family.name}
        </Link>
        <p className="hidden text-sm tracking-widest text-muted uppercase sm:block">
          Книга семьи{ko ? <> · <span lang="ko">우리 이야기</span></> : null}
        </p>
      </nav>

      <header className="flex items-center gap-5">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- подписанная ссылка Storage на час
          <img src={photo} alt={name} className="size-24 rounded-card object-cover shadow-card md:size-32" />
        ) : (
          <div aria-hidden className="flex size-24 items-center justify-center rounded-card bg-paper-deep font-serif text-4xl text-muted md:size-32">
            {name.slice(0, 1)}
          </div>
        )}
        <div className="flex flex-col gap-1">
          <p className="font-serif text-2xl leading-tight md:text-3xl">{name}</p>
          {ko && storyteller?.name_ko && (
            <p className="font-serif text-xl text-ink-soft" lang="ko">
              {storyteller.name_ko}
            </p>
          )}
          {meta && <p className="text-sm text-muted">{meta}</p>}
        </div>
      </header>

      <AdditionBanner story={story} token={token} place="chapter" />

      {ready ? (
        <>
          {kkSpread ? (
            <SpreadKk
              ru={{ block: block?.ru ?? null, title: story.title, quote: story.quote, text: story.text_ru }}
              kk={kkSpread.page && { block: null, ...kkSpread.page }}
            />
          ) : (
            <Spread
              ru={{ block: block?.ru ?? null, title: story.title, quote: story.quote, text: story.text_ru }}
              ko={ko ? { block: block?.ko ?? null, title: story.title_ko, quote: story.quote_ko, text: story.text_ko } : { block: null, title: null, quote: null, text: null }}
            />
          )}

          {extra.includes("kk") && kk?.page && <ExtraLang lang="kk" page={{ block: null, ...kk.page }} />}
          {extra.includes("ko") && story.text_ko && (
            <ExtraLang lang="ko" page={{ block: null, title: story.title_ko, quote: story.quote_ko, text: story.text_ko }} />
          )}

          <div className="grid gap-6 md:grid-cols-[1fr_minmax(0,22rem)] md:items-center">
            <QrCode url={voice} fileName={`qr-${story.id.slice(0, 8)}.svg`} langs={langs} />
            <ShareButton
              url={voice}
              title={story.title ?? family.name}
              text={`Послушайте, как ${name} рассказывает${story.title ? ` «${story.title}»` : ""}:`}
            />
          </div>

          <Link
            href={`/draft/${story.id}?token=${encodeURIComponent(token)}`}
            className="inline-flex min-h-12 items-center justify-center gap-2 self-start rounded-button border border-line bg-paper px-5 py-3 text-ink-soft"
          >
            ✎ Исправить имена и даты
          </Link>
          <Link
            href={`/f/${token}/names`}
            className="-mt-4 inline-flex min-h-12 items-center gap-2 self-start text-ink-soft underline-offset-4 hover:underline"
          >
            Словарь имён: одно имя — сразу во всех главах →
          </Link>
        </>
      ) : (
        <StoryWaiting
          storyId={story.id}
          token={token}
          langs={langs}
          initial={{ status: story.status, done: false, message: statusMessage(story.status, langs), error: story.error, updatedAt: story.updated_at }}
        />
      )}
    </main>
  );
}
