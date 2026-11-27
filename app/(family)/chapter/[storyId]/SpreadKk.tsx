"use client";
// #274 (флаг lang_kk): разворот главы RU | KZ для книги «Русский и казахский». Повторяет Spread (RU | KR) —
// на планшете и десктопе две страницы, на телефоне переключатель «Русский / Қазақша»; Spread для ru,ko не меняется.
// Казахский набирается тем же Noto Serif (кириллица + cyrillic-ext: әіңғүұқөһ), как в PDF книги.
import { useState } from "react";
import { paragraphs } from "@/components/chapter/text";
import type { SpreadPage } from "@/components/chapter/Spread";

type Lang = "ru" | "kk";

export function SpreadKk({ ru, kk }: { ru: SpreadPage; kk: SpreadPage | null }) {
  const [lang, setLang] = useState<Lang>("ru");
  const hasKk = Boolean(kk?.text);

  return (
    <section className="flex flex-col gap-4">
      {hasKk && (
        <div role="tablist" aria-label="Язык главы" className="sticky top-2 z-10 mx-auto grid w-full max-w-xs grid-cols-2 rounded-button border border-line bg-paper p-1 shadow-card md:hidden">
          {(["ru", "kk"] as const).map((l) => (
            <button
              key={l}
              type="button"
              role="tab"
              aria-selected={lang === l}
              onClick={() => setLang(l)}
              className={`min-h-12 rounded-button px-4 py-2 text-lg ${lang === l ? "bg-ink text-paper" : "text-ink-soft"}`}
              lang={l}
            >
              {l === "ru" ? "Русский" : "Қазақша"}
            </button>
          ))}
        </div>
      )}

      <div className={`overflow-hidden rounded-card bg-paper-deep shadow-card ${hasKk ? "md:grid md:grid-cols-2" : ""}`}>
        <Page page={ru} lang="ru" hidden={hasKk && lang !== "ru"} />
        {hasKk && kk && <Page page={kk} lang="kk" hidden={lang !== "kk"} spine />}
      </div>
    </section>
  );
}

function Page({ page, lang, hidden, spine = false }: { page: SpreadPage; lang: Lang; hidden: boolean; spine?: boolean }) {
  const quote = page.quote?.replace(/^[«"“„]+|[»"”]+$/g, "").trim();
  return (
    <article
      lang={lang}
      data-testid={`chapter-page-${lang}`}
      className={`${hidden ? "hidden md:flex" : "flex"} flex-col gap-5 px-6 py-8 md:px-10 md:py-12 ${
        spine ? "md:border-l md:border-line md:shadow-[inset_12px_0_16px_-14px_rgb(43_36_32_/_0.25)]" : ""
      }`}
    >
      {page.block && <p className="text-sm tracking-widest text-muted uppercase">{page.block}</p>}
      {page.title && <h2 className="font-serif text-3xl leading-tight text-ink md:text-4xl">{page.title}</h2>}
      {quote && (
        <blockquote className="relative border-l-4 border-seal py-1 pl-5">
          <p className="font-serif text-2xl leading-snug text-ink md:text-[1.75rem]">
            <span aria-hidden className="text-seal">«</span>
            {quote}
            <span aria-hidden className="text-seal">»</span>
          </p>
        </blockquote>
      )}
      <div className="flex flex-col gap-4 font-serif text-elder text-ink-soft">
        {paragraphs(page.text).map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
    </article>
  );
}
