// #353: материал для ссылки проверяющего. ТОЛЬКО вымышленные тексты:
//   • сейчас — наборы из репозитория (главы прогона eval по вымышленным персонажам и демо, app/admin/reviews/_lib/sets.ts);
//   • после слияния Q1 (#352) — банк quality_items (store.ts → qualityMaterials; сюда — общая форма и выбор).
// Главы живых семей сюда не попадают никогда: модуль не читает stories (тест materials.test.ts).
import { KZ_GLOSSARY } from "@/content/packs/kz/glossary";
import type { ReviewPair } from "@/lib/types";
import { REVIEW_SETS, type ItemSeed } from "@/app/admin/reviews/_lib/sets";
import { TERMS_MIN, detectFocusTerms, nuanceTags, type CheckKind, type FocusTerm } from "./core";

export type CheckItemSeed = ItemSeed & { focus_terms: FocusTerm[] | null; item_ref: string | null };

export interface Material {
  /** Стабильный id выбора: `<набор>#<номер>` (eval:2026-11-27-ru-ko#3, demo#0) или `quality:<uuid>` */
  id: string;
  pair: ReviewPair;
  origin: "eval" | "demo" | "quality";
  originLabel: string;
  title: string | null;
  persona: string;
  /** Теги нюансов (банк Q1 — nuance_tags текста; наборы — по словам оригинала) + персонаж */
  tags: string[];
  focusTerms: FocusTerm[];
  words: number;
  seed: Omit<CheckItemSeed, "position">;
}

const KK_EXTRA = KZ_GLOSSARY.filter((t) => !t.unsure).map((t) => [t.kk, t.meaning.split(/[:;(]/)[0]!.trim().slice(0, 40)] as const);

export function focusFor(text: string, to: string): FocusTerm[] {
  if (to === "kk") return detectFocusTerms(text, "kk", KK_EXTRA);
  if (to === "ko") return detectFocusTerms(text, "ko");
  return [];
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Материал из наборов репозитория (тексты глав: демо и прогоны eval). */
export function setMaterials(pair: ReviewPair): Material[] {
  return REVIEW_SETS.filter((s) => s.mode === "texts" && s.pairs.includes(pair)).flatMap((set) =>
    set.items(pair).map((item, i): Material => {
      const origin = set.id.startsWith("eval:") ? "eval" : "demo";
      const focus = focusFor(item.model_text, item.target_lang);
      const { position: _p, ...rest } = item;
      void _p;
      return {
        id: `${set.id}#${i}`,
        pair,
        origin,
        originLabel: origin === "eval" ? `eval ${set.id.slice(5)}` : "демо",
        title: item.title,
        persona: item.persona,
        tags: [...nuanceTags(item.source_text), `персонаж: ${item.persona}`],
        focusTerms: focus,
        words: words(item.source_text),
        seed: { ...rest, focus_terms: focus.length ? focus : null, item_ref: null },
      };
    }),
  );
}

/** Годится ли материал для режима: «слова» — нужно ≥ 3 фокус-слов. */
export function fitsKind(m: Pick<Material, "focusTerms">, kind: CheckKind): boolean {
  return kind === "text" || m.focusTerms.length >= TERMS_MIN;
}

export const MAX_ITEMS = 30;

/**
 * Выбор из формы → строки review_items. Только id из списка материала (текст с клиента не принимаем),
 * порядок — как отмечено, без повторов; для «слов» — только с ≥ 3 фокус-словами.
 */
export function pickItems(all: readonly Material[], ids: readonly string[], kind: CheckKind): CheckItemSeed[] {
  const byId = new Map(all.map((m) => [m.id, m]));
  const seen = new Set<string>();
  const out: CheckItemSeed[] = [];
  for (const id of ids) {
    const m = byId.get(id);
    if (!m || seen.has(id) || !fitsKind(m, kind)) continue;
    seen.add(id);
    out.push({ ...m.seed, position: out.length, focus_terms: kind === "terms" ? m.focusTerms : m.seed.focus_terms });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

/** Все теги материала пары — для фильтра в форме (сначала теги нюансов, потом персонажи). */
export function materialTags(all: readonly Material[]): string[] {
  const tags = [...new Set(all.flatMap((m) => m.tags))];
  return tags.sort((a, b) => Number(a.startsWith("персонаж")) - Number(b.startsWith("персонаж")) || a.localeCompare(b, "ru"));
}
