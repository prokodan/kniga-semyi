// #235 → #277: страница древа в PDF книги — те же ряды поколений и пары, что на сайте; фото, имена RU + второй
// язык книги, без обрезаний (длинное имя переносится). 25+ человек — две страницы: старшие поколения и
// «рассказчик и потомки».
import type { BookTree, BookTreePerson, BookTreeRow } from "@/lib/book/pdf/model";
import type { TreeModel } from "./layout";
import { rowLang, rowTitle } from "./rows";

/** С какого числа людей древо — на двух страницах */
export const TWO_PAGES_AT = 25;

export function treeForBook(model: TreeModel, langs: readonly string[]): BookTree | null {
  if (model.nodes.length < 2) return null;
  const lang = rowLang(langs);
  const byId = new Map([...model.nodes, ...model.hidden].map((n) => [n.id, n]));
  const viewerFemale = model.nodes.find((n) => n.isViewer)?.gender === "f";
  const person = (id: string): BookTreePerson => {
    const n = byId.get(id)!;
    return {
      name: n.name,
      nameKo: lang === "ko" ? n.nameKo : null,
      years: n.years,
      label: n.isViewer ? null : (n.label?.ru ?? null),
      viewer: n.isViewer,
      photoPath: n.photo,
      photo: null,
    };
  };
  const rows: (BookTreeRow & { rel: number | null })[] = model.rows.map((r) => {
    const t = rowTitle(r.rel, lang, viewerFemale);
    return { rel: r.rel, title: t?.ru ?? null, second: t?.second ?? null, units: r.units.map((u) => u.map(person)) };
  });
  const strip = (list: typeof rows): BookTreeRow[] => list.map(({ title, second, units }) => ({ title, second, units }));
  if (model.nodes.length < TWO_PAGES_AT || rows.length < 2) return { pages: [strip(rows)] };
  // две страницы: до ряда рассказчика / с ряда рассказчика; без рассказчика — пополам по людям
  let cut = rows.findIndex((r) => r.rel === 0);
  if (cut <= 0) {
    let count = 0;
    cut = rows.findIndex((r) => (count += r.units.flat().length) >= model.nodes.length / 2) + 1;
    cut = Math.min(Math.max(cut, 1), rows.length - 1);
  }
  return { pages: [strip(rows.slice(0, cut)), strip(rows.slice(cut))] };
}

/** Все пути фото древа (для загрузки перед сборкой PDF) */
export function treePhotoPaths(tree: BookTree): string[] {
  return [...new Set(tree.pages.flat().flatMap((r) => r.units.flat()).map((p) => p.photoPath).filter((p): p is string => !!p))];
}
