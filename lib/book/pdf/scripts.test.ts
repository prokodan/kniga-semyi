// #97: смешанные алфавиты в PDF. Кириллица внутри корейского и хангыль внутри русского должны
// печататься своим шрифтом, без чужих глифов («Ерлан» → «@;0=») и наездов на соседние буквы.
// Проверяем по самому PDF: страницы рендерятся в PNG (mupdf, WASM — без системных пакетов), из страниц
// извлекается текст с именем шрифта каждого символа.
// Посмотреть картинки: BOOK_PNG_OUT=/tmp/png npx vitest run lib/book/pdf/scripts.test.ts
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as mupdf from "mupdf";
import { describe, expect, it } from "vitest";
import { DEMO_BOOK, DEMO_STORIES } from "./demo";
import { renderBook } from "./render";

const MIXED = "Ерлан 질 ЗИЛ 고맙습니다";
const voiceUrl = (id: string) => `https://kniga.example/listen/${id}?s=AAAAAAAAAAAAAAAAAAAAAA`;

const CYR = /[Ѐ-ӿ]/;
const HANGUL = /[가-힣ㄱ-ㆎ]/;

interface Glyph {
  c: string;
  font: string;
  x: number;
  w: number;
}

/** Символы страницы построчно: буква, шрифт, x и ширина (из mupdf structured text). */
function pageLines(page: mupdf.PDFPage): Glyph[][] {
  const lines: Glyph[][] = [];
  const st = page.toStructuredText("preserve-whitespace");
  let cur: Glyph[] = [];
  st.walk({
    beginLine: () => {
      cur = [];
    },
    onChar: (c, _origin, font, _size, quad) => {
      cur.push({ c, font: font.getName(), x: quad[0], w: quad[2] - quad[0] });
    },
    endLine: () => {
      lines.push(cur);
    },
  });
  return lines;
}

const text = (g: Glyph[]) => g.map((x) => x.c).join("");

describe("PDF: смешанные алфавиты (#97)", () => {
  it("«Ерлан 질 ЗИЛ 고맙습니다» в русском и корейском столбцах — каждая буква своим шрифтом", async () => {
    const one = DEMO_STORIES[0]!;
    const story = {
      ...one,
      title: `Друг ${MIXED}`,
      title_ko: `친구 ${MIXED}`,
      quote: `Сказал: ${MIXED}`,
      quote_ko: `말했다: ${MIXED}`,
      text_ru: `Русский столбец: ${MIXED}. Год 1937, машина ZIL-157.`,
      text_ko: `한국어 단: ${MIXED}. 1937년, ZIL-157.`,
    };
    const r = await renderBook({ ...DEMO_BOOK, stories: [story], voiceUrl });
    expect(r.missingKorean).toEqual([]);

    const doc = mupdf.Document.openDocument(r.pdf, "application/pdf") as mupdf.PDFDocument;
    const out = process.env.BOOK_PNG_OUT;
    if (out) mkdirSync(out, { recursive: true });

    const hits: { line: string; glyphs: Glyph[] }[] = [];
    for (let i = 0; i < doc.countPages(); i++) {
      const page = doc.loadPage(i) as mupdf.PDFPage;

      // Рендер страницы в PNG: страница не пустая (есть «чернила» на бумаге).
      const pix = page.toPixmap(mupdf.Matrix.scale(1.5, 1.5), mupdf.ColorSpace.DeviceRGB, false, true);
      const png = pix.asPNG();
      expect(png.length).toBeGreaterThan(1000);
      const px = pix.getPixels();
      let ink = 0;
      for (let p = 0; p < px.length; p += 3) if (px[p]! < 120 && px[p + 1]! < 120 && px[p + 2]! < 120) ink++;
      expect(ink).toBeGreaterThan(50);
      if (out) writeFileSync(path.join(out, `mixed-${String(i + 1).padStart(2, "0")}.png`), png);

      for (const g of pageLines(page)) {
        const t = text(g);
        const at = t.indexOf(MIXED);
        if (at >= 0) hits.push({ line: t, glyphs: g.slice(at, at + [...MIXED].length) });
      }
    }

    // Строка есть целиком в обоих столбцах: заголовок, цитата и текст RU и KR (+ колонтитулы не в счёт).
    expect(hits.length).toBeGreaterThanOrEqual(6);
    const lines = hits.map((h) => h.line).join("\n");
    expect(lines).toContain(`Русский столбец: ${MIXED}`);
    expect(lines).toContain(`한국어 단: ${MIXED}`);

    for (const { line, glyphs } of hits) {
      expect(text(glyphs), line).toBe(MIXED);
      for (const g of glyphs) {
        if (CYR.test(g.c)) expect(g.font, `${g.c} в «${line}»`).toMatch(/NotoSerif-(Regular|Bold|Italic)/);
        if (HANGUL.test(g.c)) expect(g.font, `${g.c} в «${line}»`).toMatch(/NotoSerifKR/);
      }
      // Без наездов: каждая следующая буква начинается не левее конца предыдущей (допуск 0,5 pt).
      for (let k = 1; k < glyphs.length; k++) {
        const a = glyphs[k - 1]!;
        const b = glyphs[k]!;
        expect(b.x, `«${a.c}${b.c}» в «${line}»`).toBeGreaterThanOrEqual(a.x + a.w - 0.5);
      }
    }
  }, 60_000);
});

describe("PDF: казахские буквы (#231)", () => {
  const KK = "әіңғүұқөһ ӘІҢҒҮҰҚӨҺ";
  it("әіңғүұқөһ в казахском столбце — шрифтом Noto Serif (как русский), каждая буква на месте", async () => {
    const one = DEMO_STORIES[0]!;
    const texts = [{ story_id: one.id, lang: "kk" as const, title: `Тарау ${KK}`, text: `Қазақша мәтін: ${KK}. 1941 жылы.`, quote: `Сөз ${KK}` }];
    const r = await renderBook({ ...DEMO_BOOK, stories: [one], voiceUrl, langs: ["ru", "kk"], texts });
    const doc = mupdf.Document.openDocument(r.pdf, "application/pdf") as mupdf.PDFDocument;
    const out = process.env.BOOK_PNG_OUT;
    if (out) mkdirSync(out, { recursive: true });
    const hits: Glyph[][] = [];
    for (let i = 0; i < doc.countPages(); i++) {
      const page = doc.loadPage(i) as mupdf.PDFPage;
      if (out) writeFileSync(path.join(out, `kk-${String(i + 1).padStart(2, "0")}.png`), page.toPixmap(mupdf.Matrix.scale(1.5, 1.5), mupdf.ColorSpace.DeviceRGB, false, true).asPNG());
      for (const g of pageLines(page)) {
        const t = text(g);
        const at = t.indexOf(KK);
        if (at >= 0) hits.push(g.slice(at, at + [...KK].length));
      }
    }
    expect(hits.length).toBeGreaterThanOrEqual(3); // заголовок, цитата, текст
    for (const glyphs of hits) {
      expect(text(glyphs)).toBe(KK);
      for (const g of glyphs) if (g.c.trim()) expect(g.font, g.c).toMatch(/NotoSerif-(Regular|Bold|Italic)/);
      for (let k = 1; k < glyphs.length; k++) expect(glyphs[k]!.x).toBeGreaterThanOrEqual(glyphs[k - 1]!.x + glyphs[k - 1]!.w - 0.5);
    }
  }, 60_000);
});
