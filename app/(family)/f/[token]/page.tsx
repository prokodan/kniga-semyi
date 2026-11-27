import { groupBySection } from "@/lib/book/order";
import type { Metadata } from "next";
import Link from "next/link";
import { requestOrigin } from "@/lib/book/chapter";
import { blockProgress, getFamilyByToken, getFamilyStore } from "@/lib/db/access";
import { flag } from "@/lib/flags";
import { healFamily } from "@/lib/pipeline/heal";
import { choiceOf, effectiveBookLangs } from "@/lib/pipeline/langs";
import { BlockProgress } from "../../_ui/BlockProgress";
import { LinkNotFound } from "../../_ui/LinkNotFound";
import { ShareLink } from "../../_ui/ShareLink";
import { BookLangs } from "./BookLangs";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Книга семьи", robots: { index: false, follow: false } };

/**
 * #166: подпись главы — её название, даже пока идёт перевод («Пигоди в школе»), а не название раздела.
 * Названия ещё нет — «глава собирается…»; готовая глава без названия — раздел, как раньше.
 */
function chapterLabel(c: { status: string; title?: string | null }, section: string): string {
  const title = c.title?.trim();
  if (title) return title;
  return c.status === "ready" ? section : "глава собирается…";
}

const cta = "button flex items-center justify-center rounded-button bg-seal px-6 py-4 text-elder font-semibold text-paper active:bg-seal-dark";

// Главная семьи по ссылке /f/<token>: рассказчик, прогресс «3 из 8», «записать».
export default async function FamilyPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ new?: string }> }) {
  const { token } = await params;
  const { new: isNew } = await searchParams;
  const view = await getFamilyByToken(token);
  if (!view) return <LinkNotFound />;

  // #166: открыли страницу семьи — подтолкнуть главы, которые стоят на шаге (после ответа страницы, в after())
  healFamily(await requestOrigin(), token);

  const { family, storyteller } = view;
  // #231: «Языки книги» (RU + KR / RU + KZ / RU) — только с флагом lang_kk
  const langKk = flag("lang_kk", { familyId: family.id, labs: family.labs });
  const tree = flag("family_tree", { familyId: family.id, labs: family.labs }); // #235
  const progress = blockProgress(view.stories, storyteller?.id);
  const photo = storyteller?.photo_url ? await getFamilyStore().photoUrl(storyteller.photo_url) : null;
  const chapters = view.stories.filter((s) => !s.parent_story_id && s.storyteller_id === storyteller?.id);
  let n = 0; // сквозной номер главы — как в книге
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

      {chapters.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-serif text-2xl">Главы</h2>
          {groupBySection(chapters).map((sec) => (
            <div key={sec.block ?? "none"} className="flex flex-col gap-2">
              <h3 className="mt-2 text-sm tracking-widest text-seal uppercase">
                {sec.ru} <span lang="ko">· {sec.ko}</span>
              </h3>
              <ul className="flex flex-col gap-2">
                {sec.items.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/chapter/${c.id}?token=${token}`}
                      className="flex min-h-12 items-center justify-between gap-3 rounded-card border border-line bg-paper px-4 py-3"
                    >
                      <span>
                        {++n}. {chapterLabel(c, sec.ru)}
                      </span>
                      <span className={`text-sm ${c.status === "ready" ? "text-jade" : c.status === "failed" ? "text-danger" : "text-muted"}`}>
                        {c.status === "ready" ? "читать →" : c.status === "failed" ? "нужна помощь" : "готовится…"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <Link
            href={`/book/${token}`}
            className="mt-2 flex min-h-12 items-center justify-between gap-3 rounded-card bg-paper-deep px-4 py-3 font-semibold shadow-card"
          >
            <span>Книга целиком (PDF)</span>
            <span className="text-seal">открыть →</span>
          </Link>
          <Link
            href={`/f/${token}/names`}
            className="flex min-h-12 items-center justify-between gap-3 rounded-card border border-line bg-paper px-4 py-3"
          >
            <span>
              Словарь имён <span className="text-ink-soft">· люди, места, слова</span>
            </span>
            <span className="text-seal">→</span>
          </Link>
          {tree && (
            <Link
              href={`/f/${token}/tree`}
              className="flex min-h-12 items-center justify-between gap-3 rounded-card border border-line bg-paper px-4 py-3"
            >
              <span>
                Древо семьи <span className="text-ink-soft">· кто кому кем приходится</span>
              </span>
              <span className="text-seal">→</span>
            </Link>
          )}
          <Link
            href={`/checkout/${token}`}
            className="flex min-h-12 items-center justify-between gap-3 rounded-card border border-line bg-paper px-4 py-3"
          >
            <span>Выбрать книгу: цифровая или печатная</span>
            <span className="text-seal">→</span>
          </Link>
        </section>
      )}

      {langKk && <BookLangs token={token} current={choiceOf(effectiveBookLangs(family, true))} />}

      {!isNew && (
        <section className="flex flex-col gap-3 border-t border-line pt-5">
          <p className="text-ink-soft">Пригласить родных записывать вместе:</p>
          <ShareLink token={token} title={family.name} />
        </section>
      )}
    </main>
  );
}
