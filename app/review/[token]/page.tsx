// /review/<токен> — страница носителя языка (#232, docs/v2/LANGUAGES.md §3). Без входа: личная ссылка из /admin/reviews.
// Только вымышленные тексты (eval-персонажи, демо, вопросы банка). Подписи — на языке пары и по-русски.
// Флаг не нужен: семьи страницу не видят, ссылку выдаёт команда.
import type { Metadata } from "next";
import { alignParagraphs, pairLangs } from "@/app/admin/reviews/_lib/core";
import { openReview } from "@/app/admin/reviews/_lib/store";
import type { BookLang } from "@/lib/types";
import { dictionary, t } from "../_lib/strings";
import { ReviewApp, type ClientFeedback, type ClientItem } from "./ReviewApp";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Проверка перевода · Книга семьи",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function Shell({ lang, children }: { lang: BookLang; children: React.ReactNode }) {
  const title = t(lang, "title");
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-4 bg-paper px-4 py-6 text-ink sm:px-6" lang={lang}>
      <header>
        <p className="text-xs tracking-widest text-muted uppercase" lang="ru">
          Книга семьи
        </p>
        <h1 className="font-serif text-2xl">
          {title.native}
          {title.ru ? (
            <span lang="ru" className="block text-base text-muted">
              {title.ru}
            </span>
          ) : null}
        </h1>
      </header>
      {children}
    </main>
  );
}

function Message({ lang, k }: { lang: BookLang; k: "invalid" | "expired" }) {
  // язык неизвестен (ссылки нет) — показываем все три
  const langs: BookLang[] = lang === "ru" ? ["ko", "kk"] : [lang];
  return (
    <Shell lang={langs[0]!}>
      <section className="flex flex-col gap-2 rounded-card bg-paper-deep p-5 shadow-card" data-testid="review-closed">
        {langs.map((l) => (
          <p key={l} lang={l}>
            {t(l, k).native}
          </p>
        ))}
        <p lang="ru" className="text-ink-soft">
          {t("ko", k).ru}
        </p>
      </section>
    </Shell>
  );
}

export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const opened = await openReview(token);
  if (opened.status === "missing") return <Message lang="ru" k="invalid" />;
  const { to } = pairLangs(opened.link.pair);
  if (opened.status !== "active" || !opened.bundle) return <Message lang={to} k="expired" />;

  const { items, feedback } = opened.bundle;
  const clientItems: ClientItem[] = items.map((i) => ({
    id: i.id,
    title: i.title,
    kind: i.kind,
    paragraphs: alignParagraphs(i.source_text, i.model_text),
  }));
  const initial: Record<string, ClientFeedback> = {};
  for (const f of feedback) {
    initial[`${f.item_id}:${f.paragraph}`] = {
      paragraph: f.paragraph,
      edited_text: f.edited_text,
      ratings: f.ratings ?? {},
      comment: f.comment,
      skipped: f.skipped,
    };
  }
  const dict = dictionary(to);
  const intro = opened.link.mode === "questions" ? dict.introQuestions : dict.intro;

  return (
    <Shell lang={to}>
      <section className="flex flex-col gap-2 rounded-card bg-paper-deep p-4 text-ink-soft">
        <p>{intro.native}</p>
        {intro.ru ? <p lang="ru" className="text-sm text-muted">{intro.ru}</p> : null}
        <p className="text-sm">
          {dict.fiction.native}
          {dict.fiction.ru ? <span lang="ru" className="text-muted"> · {dict.fiction.ru}</span> : null}
        </p>
      </section>
      <ReviewApp token={token} lang={to} items={clientItems} initial={initial} dict={dict} />
    </Shell>
  );
}
