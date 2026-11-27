// #277: страницы древа из PDF книги → PNG (mupdf, WASM — без системных пакетов). Для снимков PR и проверки глазами.
//   npx tsx scripts/tree-pdf-preview.ts <папка> [имя=путь.pdf …]
// Без PDF на входе — только синтетическая семья на 40 человек (lib/tree/fixtures/big-family.ts): книга-пример
// DEMO_BOOK + её древо, RU + KR и RU + KZ. Печатает пути PNG. В базу не ходит.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEMO_BOOK } from "@/lib/book/pdf/demo";
import { renderBook } from "@/lib/book/pdf/render";
import { applyPlan, planTree } from "@/lib/tree/build";
import { treeForBook } from "@/lib/tree/book";
import { bigFamily } from "@/lib/tree/fixtures/big-family";
import { layoutTree } from "@/lib/tree/layout";

/** Страницы, где есть «Древо семьи» (заголовок страницы древа), — в PNG. */
type Mupdf = typeof import("mupdf");

function treePages(mupdf: Mupdf, pdf: Uint8Array, outDir: string, name: string): string[] {
  const doc = mupdf.Document.openDocument(pdf, "application/pdf");
  const out: string[] = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    const text = page.toStructuredText("preserve-whitespace").asText();
    if (!/ДРЕВО СЕМЬИ|Древо семьи/.test(text) || /Оглавление|ОГЛАВЛЕНИЕ/.test(text)) continue;
    const png = page.toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true).asPNG();
    const file = path.join(outDir, `${name}-p${i + 1}.png`);
    writeFileSync(file, png);
    out.push(file);
  }
  return out;
}

async function main() {
  const [outDir = "e2e-screens/tree", ...inputs] = process.argv.slice(2);
  mkdirSync(outDir, { recursive: true });
  const files: string[] = [];
  // mupdf — ESM с await верхнего уровня: только динамический import (скрипт запускается tsx как CommonJS)
  const mupdf: Mupdf = await import("mupdf");

  const src = bigFamily();
  const plan = planTree(src, (() => {
    let n = 0;
    return () => `p${++n}`;
  })());
  const model = layoutTree(applyPlan(src, plan), plan.claims);
  const voiceUrl = (id: string) => `https://kniga.example/listen/${id}`;
  for (const langs of [["ru", "ko"], ["ru", "kk"]] as const) {
    const book = await renderBook({ ...DEMO_BOOK, voiceUrl, langs: [...langs], tree: treeForBook(model, langs) });
    files.push(...treePages(mupdf, book.pdf, outDir, `pdf-big-40-${langs.join("-")}`));
  }

  for (const arg of inputs) {
    const [name, file] = arg.includes("=") ? (arg.split("=") as [string, string]) : [path.basename(arg, ".pdf"), arg];
    files.push(...treePages(mupdf, readFileSync(file), outDir, `pdf-${name}`));
  }
  console.info(files.join("\n"));
  if (!files.length) throw new Error("страниц древа не нашлось");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
