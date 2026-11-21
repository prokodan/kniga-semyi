"use client";
import { useState } from "react";
import { Quote } from "./Quote";
import { paragraphs } from "./text";

export interface SpreadPage {
  block: string | null;
  title: string | null;
  quote: string | null;
  text: string | null;
}

// Разворот главы: на планшете и десктопе — две страницы RU | KR, на телефоне — переключатель RU / 한국어.
// Обе страницы рендерятся на сервере; на телефоне скрытая — просто display:none (без перезагрузки).
export function Spread({ ru, ko }: { ru: SpreadPage; ko: SpreadPage }) {
  const [lang, setLang] = useState<"ru" | "ko">("ru");
  const hasKo = Boolean(ko.text);

  return (
    <section className="flex flex-col gap-4">
      {hasKo && (
        <div role="tablist" aria-label="Язык главы" className="sticky top-2 z-10 mx-auto grid w-full max-w-xs grid-cols-2 rounded-button border border-line bg-paper p-1 shadow-card md:hidden">
          {(["ru", "ko"] as const).map((l) => (
            <button
              key={l}
              type="button"
              role="tab"
              aria-selected={lang === l}
              onClick={() => setLang(l)}
              className={`rounded-button px-4 py-2 text-lg ${lang === l ? "bg-ink text-paper" : "text-ink-soft"}`}
              lang={l}
            >
              {l === "ru" ? "Русский" : "한국어"}
            </button>
          ))}
        </div>
      )}

      <div className={`overflow-hidden rounded-card bg-paper-deep shadow-card ${hasKo ? "md:grid md:grid-cols-2" : ""}`}>
        <Page page={ru} lang="ru" hidden={hasKo && lang !== "ru"} />
        {hasKo && <Page page={ko} lang="ko" hidden={lang !== "ko"} spine />}
      </div>
    </section>
  );
}

function Page({ page, lang, hidden, spine = false }: { page: SpreadPage; lang: "ru" | "ko"; hidden: boolean; spine?: boolean }) {
  const ko = lang === "ko";
  return (
    <article
      lang={lang}
      className={`${hidden ? "hidden md:flex" : "flex"} flex-col gap-5 px-6 py-8 md:px-10 md:py-12 ${
        spine ? "md:border-l md:border-line md:shadow-[inset_12px_0_16px_-14px_rgb(43_36_32_/_0.25)]" : ""
      } ${ko ? "break-keep" : ""}`}
    >
      {page.block && <p className="text-sm tracking-widest text-muted uppercase">{page.block}</p>}
      {page.title && <h2 className="font-serif text-3xl leading-tight text-ink md:text-4xl">{page.title}</h2>}
      <Quote text={page.quote} lang={lang} />
      <div className={`flex flex-col gap-4 font-serif text-ink-soft ${ko ? "text-lg leading-[1.9]" : "text-elder"}`}>
        {paragraphs(page.text).map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
    </article>
  );
}
