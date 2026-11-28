// Рендер книги в PDF (I5). Два прохода: первый узнаёт страницы глав и их число, второй печатает
// оглавление с номерами (вёрстка не меняется: номера занимают то же место, что «·»).
import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { BookDocument, type PageCollector, type PageMap } from "./document";
import { missingKorean, registerBookFonts } from "./fonts";
import { composeBook, type BookInput } from "./model";

export interface RenderedBook {
  pdf: Buffer;
  pageCount: number;
  chapters: number;
  /** Корейские слоги, которых нет в подмножестве шрифта (пропадут в PDF) — для лога */
  missingKorean: string[];
  ms: number;
}

function doc(props: Parameters<typeof BookDocument>[0]): ReactElement<DocumentProps> {
  return createElement(BookDocument, props) as unknown as ReactElement<DocumentProps>;
}

export async function renderBook(input: BookInput, opts: { fontsDir?: string } = {}): Promise<RenderedBook> {
  const started = Date.now();
  registerBookFonts(opts.fontsDir);
  const book = composeBook(input);
  if (book.chapters.length === 0) throw new Error("В книге пока нет готовых глав");

  const pages: PageMap = {};
  let total = 0;
  const collect: PageCollector = {
    mark: (id, n) => {
      pages[id] = Math.min(pages[id] ?? n, n); // fixed-метка повторяется на всех страницах главы
    },
    page: (n, t) => {
      total = Math.max(total, t ?? n);
    },
  };
  await renderToBuffer(doc({ book, collect }));
  const pdf = await renderToBuffer(doc({ book, pages }));

  // Хангыль ищем во всех текстах: после #97 он печатается и внутри русского («고맙습니다»).
  const koText =
    book.chapters.map((c) => [c.title, c.titleKo, c.quote, c.quoteKo, c.textRu, c.textKo].join(" ")).join(" ") +
    ` ${book.storyteller.name} ${book.storyteller.name_ko ?? ""}` +
    ` ${(book.tree?.pages ?? []).flat().flatMap((r) => [r.second ?? "", ...r.units.flat().map((p) => p.nameKo ?? "")]).join(" ")}` +
    // #340: докупленный корейский — та же проверка подмножества шрифта
    book.extras.flatMap((p) => (p.lang === "ko" ? p.chapters.map((c) => ` ${c.title} ${c.quote ?? ""} ${c.text}`) : [])).join("");
  return {
    pdf,
    pageCount: total || countPages(pdf),
    chapters: book.chapters.length,
    missingKorean: missingKorean(koText, opts.fontsDir),
    ms: Date.now() - started,
  };
}

/** Запасной счёт страниц по объектам /Type /Page. */
export function countPages(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}
