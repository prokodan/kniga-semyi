// #235: страница древа в PDF книги — ряды поколений из той же раскладки, что на сайте.
import type { BookTree } from "@/lib/book/pdf/model";
import type { TreeModel } from "./layout";

/** Сколько людей влезает на страницу A5 (дальше — без самых дальних рядов) */
const MAX_PEOPLE = 32;

export function treeForBook(model: TreeModel, showKo: boolean): BookTree | null {
  if (model.nodes.length < 2) return null;
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const right = new Set(model.couples.map(([l]) => l));
  const viewerRow = model.rows.findIndex((r) => r.ids.some((id) => byId.get(id)?.isViewer));
  // ближние к рассказчику ряды — первыми, пока влезают
  const order = model.rows.map((r, i) => ({ r, i })).sort((a, b) => Math.abs(a.i - viewerRow) - Math.abs(b.i - viewerRow));
  const keep = new Set<number>();
  let count = 0;
  for (const { r, i } of order) {
    if (count + r.ids.length > MAX_PEOPLE && keep.size) break;
    keep.add(i);
    count += r.ids.length;
  }
  return {
    rows: model.rows
      .filter((_, i) => keep.has(i))
      .map((r) =>
        r.ids.map((id) => {
          const n = byId.get(id)!;
          return {
            name: n.name,
            nameKo: showKo ? n.nameKo : null,
            years: n.years,
            label: n.isViewer ? null : (n.label?.ru ?? null),
            viewer: n.isViewer,
            spouseOfNext: right.has(id),
          };
        }),
      ),
  };
}
