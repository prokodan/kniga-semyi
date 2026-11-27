// #277: страница древа в PDF — большая семья (40 человек, фикстура) печатается целиком, без обрезаний.
// Снимки для PR: TREE_PDF_OUT=<папка> → PNG страниц древа (mupdf); TREE_PDF_IN="kim=путь.pdf,…" — ещё и готовые PDF
// (e2e пересобирает книгу Ким с фото и запускает этот тест — см. e2e/tree-screens.family.spec.ts).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as mupdf from "mupdf";
import { describe, expect, it } from "vitest";
import { DEMO_BOOK } from "@/lib/book/pdf/demo";
import { renderBook } from "@/lib/book/pdf/render";
import { applyPlan, planTree } from "./build";
import { treeForBook } from "./book";
import { bigFamily } from "./fixtures/big-family";
import { layoutTree } from "./layout";

const OUT = process.env.TREE_PDF_OUT;

/** Страницы древа (заголовок «Древо семьи», не оглавление): текст и PNG */
function treePages(pdf: Uint8Array, name: string) {
  const doc = mupdf.Document.openDocument(pdf, "application/pdf");
  const pages: { n: number; text: string }[] = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    const text = page.toStructuredText("preserve-whitespace").asText();
    if (!/ДРЕВО СЕМЬИ|Древо семьи/.test(text) || /ОГЛАВЛЕНИЕ|Оглавление/.test(text)) continue;
    pages.push({ n: i + 1, text });
    if (OUT) {
      mkdirSync(OUT, { recursive: true });
      const png = page.toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true).asPNG();
      writeFileSync(path.join(OUT, `pdf-${name}-p${i + 1}.png`), png);
    }
  }
  return pages;
}

describe("#277 PDF древа большой семьи", () => {
  const src = bigFamily();
  let n = 0;
  const plan = planTree(src, () => `p${++n}`);
  const model = layoutTree(applyPlan(src, plan), plan.claims);
  const voiceUrl = (id: string) => `https://kniga.example/listen/${id}`;

  for (const langs of [["ru", "ko"], ["ru", "kk"]] as const) {
    it(`${langs.join(" + ")}: страницы древа, все 39 человек, имена целиком`, async () => {
      const book = await renderBook({ ...DEMO_BOOK, voiceUrl, langs: [...langs], tree: treeForBook(model, langs) });
      const pages = treePages(book.pdf, `big-40-${langs.join("-")}`);
      expect(pages.length).toBeGreaterThanOrEqual(2);
      const text = pages.map((p) => p.text).join("\n").replace(/\s+/g, " ");
      for (const name of ["Нурмагамбетова Динара Кайратовна", "Цой Владислав Константинович", "Ахметжанов Нурсултан Бауыржанович", "Ли Алиса"]) {
        expect(text, name).toContain(name);
      }
      expect(text).toContain(langs[1] === "ko" ? "조부모" : "Ата-әже");
    }, 60_000);
  }

  it.runIf(OUT && process.env.TREE_PDF_IN)("готовые PDF (e2e) → PNG страниц древа", () => {
    for (const item of process.env.TREE_PDF_IN!.split(",").filter(Boolean)) {
      const [name, file] = item.split("=") as [string, string];
      expect(treePages(readFileSync(file), name).length, name).toBeGreaterThan(0);
    }
  });
});
