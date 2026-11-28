// #306 (флаг lang_change): докупленный язык книги — отдельной страницей под разворотом. Разворот базовой пары
// (RU | KR или RU | KZ) не меняется; третий язык читается ниже, тем же набором, что и разворот.
import { paragraphs } from "@/components/chapter/text";
import type { SpreadPage } from "@/components/chapter/Spread";

const LABEL: Record<"ko" | "kk", string> = { ko: "한국어", kk: "Қазақша" };

export function ExtraLang({ lang, page }: { lang: "ko" | "kk"; page: SpreadPage }) {
  const quote = page.quote?.replace(/^[«"“„]+|[»"”]+$/g, "").trim();
  return (
    <section className="flex flex-col gap-3" aria-label={`Перевод главы: ${LABEL[lang]}`}>
      <p className="text-sm tracking-widest text-muted uppercase">
        Ещё один язык книги · <span lang={lang}>{LABEL[lang]}</span>
      </p>
      <article lang={lang} data-testid={`chapter-extra-${lang}`} className="flex flex-col gap-5 rounded-card bg-paper-deep px-6 py-8 shadow-card md:px-10 md:py-12">
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
    </section>
  );
}
