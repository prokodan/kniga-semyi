// Шрифты книги (I5). TTF-подмножества Noto Serif / Noto Serif KR лежат в public/fonts
// (собираются lib/book/pdf/build-fonts.py из @fontsource, лицензия OFL — public/fonts/OFL.txt).
// В PDF react-pdf встраивает только использованные глифы, поэтому книга весит сотни КБ.
import { readFileSync } from "node:fs";
import path from "node:path";
import { Font } from "@react-pdf/renderer";

export const FONT_RU = "BookSerif";
export const FONT_KO = "BookSerifKR";

/**
 * Семейства со сменой шрифта по письменности (#97). react-pdf для каждого символа берёт первый шрифт
 * из списка, где есть глиф: кириллица в корейском тексте («Ерлан», «ЗИЛ») → Noto Serif,
 * хангыль в русском («고맙습니다») → Noto Serif KR. Без запасного шрифта такие символы печатались
 * чужими глифами («Ерлан» → «@;0=») и наезжали на соседние буквы. Латиница и цифры есть в обоих.
 */
export const FAMILY_RU: string[] = [FONT_RU, FONT_KO];
export const FAMILY_KO: string[] = [FONT_KO, FONT_RU];

/** Папка шрифтов: на Vercel public/fonts попадает в функцию через outputFileTracingIncludes (next.config.ts). */
export function fontsDir(): string {
  return path.join(process.cwd(), "public", "fonts");
}

let registered: string | null = null;

/** Регистрирует шрифты один раз на процесс. */
export function registerBookFonts(dir = fontsDir()): void {
  if (registered === dir) return;
  const f = (name: string) => path.join(/*turbopackIgnore: true*/ dir, name); // файлы в функцию кладёт next.config.ts
  Font.register({
    family: FONT_RU,
    fonts: [
      { src: f("NotoSerif-Regular.ttf"), fontWeight: 400 },
      { src: f("NotoSerif-Italic.ttf"), fontWeight: 400, fontStyle: "italic" },
      { src: f("NotoSerif-Bold.ttf"), fontWeight: 700 },
    ],
  });
  Font.register({
    family: FONT_KO,
    fonts: [
      { src: f("NotoSerifKR-Regular.ttf"), fontWeight: 400 },
      // Курсива у корейского нет: хангыль внутри русской цитаты (курсив) берёт прямое начертание.
      { src: f("NotoSerifKR-Regular.ttf"), fontWeight: 400, fontStyle: "italic" },
      { src: f("NotoSerifKR-Bold.ttf"), fontWeight: 700 },
    ],
  });
  // Без переносов: русские переносы react-pdf делает по-английски, а корейский переносится по слогам сам.
  Font.registerHyphenationCallback((word) => [word]);
  registered = dir;
}

let syllables: Set<string> | null = null;

/**
 * Слоги хангыля из текста, которых нет в подмножестве шрифта (в PDF они пропадут).
 * В шрифте 2 350 слогов KS X 1001 — редкий слог из перевода попадёт сюда и в лог сборки.
 */
export function missingKorean(text: string, dir = fontsDir()): string[] {
  syllables ??= new Set(readFileSync(path.join(/*turbopackIgnore: true*/ dir, "NotoSerifKR.syllables.txt"), "utf8"));
  const missing = new Set<string>();
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c >= 0xac00 && c <= 0xd7a3 && !syllables.has(ch)) missing.add(ch);
  }
  return [...missing];
}
