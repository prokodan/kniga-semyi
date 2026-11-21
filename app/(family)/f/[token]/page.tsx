import type { Metadata } from "next";
import Link from "next/link";
import { blockProgress, getFamilyByToken, getFamilyStore } from "@/lib/db/access";
import { BlockProgress } from "../../_ui/BlockProgress";
import { LinkNotFound } from "../../_ui/LinkNotFound";
import { ShareLink } from "../../_ui/ShareLink";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Книга семьи", robots: { index: false, follow: false } };

const cta = "button flex items-center justify-center rounded-button bg-seal px-6 py-4 text-elder font-semibold text-paper active:bg-seal-dark";

// Главная семьи по ссылке /f/<token>: рассказчик, прогресс «3 из 8», «записать».
export default async function FamilyPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ new?: string }> }) {
  const { token } = await params;
  const { new: isNew } = await searchParams;
  const view = await getFamilyByToken(token);
  if (!view) return <LinkNotFound />;

  const { family, storyteller } = view;
  const progress = blockProgress(view.stories, storyteller?.id);
  const photo = storyteller?.photo_url ? await getFamilyStore().photoUrl(storyteller.photo_url) : null;
  const years = storyteller?.birth_year ? `${storyteller.birth_year}${storyteller.death_year ? `–${storyteller.death_year}` : ""} г. р.` : null;

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-5 py-8">
      <p className="text-sm tracking-widest text-muted uppercase">Книга семьи · 우리 이야기</p>

      {isNew && (
        <section className="flex flex-col gap-3 rounded-card border border-jade/40 bg-paper p-5">
          <h2 className="font-serif text-2xl">Книга создана ✓</h2>
          <p className="text-ink-soft">
            Это ваша ссылка на книгу — сохраните её и отправьте родным. По ней можно вернуться в любой момент, без пароля.
          </p>
          <ShareLink token={token} title={family.name} />
        </section>
      )}

      <h1 className="font-serif text-3xl leading-tight">{family.name}</h1>

      {storyteller && (
        <section className="flex items-center gap-4 rounded-card bg-paper-deep p-4 shadow-card">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- подписанная ссылка Storage на час
            <img src={photo} alt={storyteller.name} className="size-20 rounded-card object-cover" />
          ) : (
            <div aria-hidden className="flex size-20 items-center justify-center rounded-card bg-paper font-serif text-3xl text-muted">
              {storyteller.name.slice(0, 1)}
            </div>
          )}
          <div className="flex flex-col">
            <p className="font-serif text-2xl">{storyteller.name}</p>
            {storyteller.name_ko && <p className="text-ink-soft" lang="ko">{storyteller.name_ko}</p>}
            <p className="text-sm text-muted">{[years, storyteller.birth_place].filter(Boolean).join(" · ")}</p>
          </div>
        </section>
      )}

      <section className="rounded-card bg-paper p-1">
        <BlockProgress covered={progress.covered} />
        <p className="mt-3 text-sm text-muted">
          Записано рассказов: {progress.stories}
          {family.gift_date ? ` · подарить к ${new Date(family.gift_date).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}` : ""}
        </p>
      </section>

      {storyteller && !storyteller.consent_at ? (
        <div className="flex flex-col gap-2">
          <Link href={`/consent/${token}`} className={cta}>
            Начать: согласие на запись
          </Link>
          <p className="text-center text-sm text-muted">Один короткий шаг перед первым рассказом — меньше минуты.</p>
        </div>
      ) : storyteller ? (
        <Link href={`/record/${token}`} className={cta}>
          {progress.stories > 0 ? "Записать ещё рассказ" : "Записать первый рассказ"}
        </Link>
      ) : null}

      {!isNew && (
        <section className="flex flex-col gap-3 border-t border-line pt-5">
          <p className="text-ink-soft">Пригласить родных записывать вместе:</p>
          <ShareLink token={token} title={family.name} />
        </section>
      )}
    </main>
  );
}
