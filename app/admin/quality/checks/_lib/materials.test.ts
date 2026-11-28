// #353: материал «Проверок» — только вымышленные тексты; выбор — только из списка; «слова» — от 3 фокус-слов;
// хранилище 2.0 в памяти: ссылка → отзыв со словами → «готово» → отозвать.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listPersonas } from "@/eval/sim/persona";
import { REVIEW_PAIRS } from "@/lib/types";
import { hashReviewToken, newReviewToken } from "@/app/admin/reviews/_lib/core";
import { CRITERIA, TERMS_MIN, itemState } from "./core";
import { MAX_ITEMS, fitsKind, materialTags, pickItems, setMaterials } from "./materials";
import { MemoryCheckStore } from "./repo";

const DIR = path.join(process.cwd(), "app/admin/quality/checks/_lib");
const EVAL = new Set(listPersonas());
const DEMO = new Set(["demo:kim", "demo:li", "demo:reserve"]);

describe("материал — только вымышленные тексты", () => {
  it("каждый текст — eval-персонаж или демо, с оригиналом и переводом", () => {
    for (const pair of REVIEW_PAIRS) {
      const all = setMaterials(pair);
      expect(all.length, pair).toBeGreaterThan(0);
      for (const m of all) {
        expect(EVAL.has(m.persona) || DEMO.has(m.persona), `${m.id}: ${m.persona}`).toBe(true);
        expect(m.seed.source_text.trim()).not.toBe("");
        expect(m.seed.model_text.trim()).not.toBe("");
        expect(`${m.seed.source_lang}-${m.seed.target_lang}`).toBe(pair);
      }
    }
  });

  it("модули материала не читают главы семей (stories / story_texts)", () => {
    for (const f of ["materials.ts", "store.ts", "core.ts"]) {
      const src = readFileSync(path.join(DIR, f), "utf8");
      expect(src, f).not.toMatch(/from\(["'](stories|story_texts|families)["']\)/);
    }
  });

  it("в каждой паре есть тексты для режима «слова» (≥ 3 фокус-слов)", () => {
    for (const pair of REVIEW_PAIRS) {
      const ok = setMaterials(pair).filter((m) => fitsKind(m, "terms"));
      expect(ok.length, pair).toBeGreaterThan(0);
      for (const m of ok) {
        expect(m.focusTerms.length).toBeGreaterThanOrEqual(TERMS_MIN);
        for (const t of m.focusTerms) expect(m.seed.model_text).toContain(t.term);
      }
    }
  });

  it("теги: нюансы и персонажи", () => {
    const tags = materialTags(setMaterials("ru-ko"));
    expect(tags).toContain("родство");
    expect(tags.some((t) => t.startsWith("персонаж: "))).toBe(true);
    expect(tags.findIndex((t) => t.startsWith("персонаж"))).toBeGreaterThan(tags.indexOf("родство"));
  });
});

describe("выбор материала", () => {
  const all = setMaterials("ru-ko");
  const terms = all.filter((m) => fitsKind(m, "terms"));
  const noTerms = all.find((m) => !fitsKind(m, "terms"));

  it("только id из списка, без повторов, порядок отметки, позиции 0…", () => {
    const ids = [all[2]!.id, "eval:чужой#0", all[0]!.id, all[2]!.id];
    const items = pickItems(all, ids, "text");
    expect(items.map((i) => i.source_text)).toEqual([all[2]!.seed.source_text, all[0]!.seed.source_text]);
    expect(items.map((i) => i.position)).toEqual([0, 1]);
    expect(items.every((i) => i.item_ref === null)).toBe(true);
  });

  it("«слова»: текст без 3 фокус-слов не берём; фокус-слова — в строке ссылки", () => {
    const ids = [terms[0]!.id, ...(noTerms ? [noTerms.id] : [])];
    const items = pickItems(all, ids, "terms");
    expect(items).toHaveLength(1);
    expect(items[0]!.focus_terms?.length).toBeGreaterThanOrEqual(TERMS_MIN);
  });

  it(`не больше ${MAX_ITEMS} текстов`, () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ ...all[0]!, id: `x#${i}` }));
    expect(pickItems(many, many.map((m) => m.id), "text")).toHaveLength(MAX_ITEMS);
  });
});

describe("хранилище 2.0 (память)", () => {
  it("ссылка → оценки и слова → готово → отозвать; тексты ссылки = выбранный материал", async () => {
    const store = new MemoryCheckStore();
    const all = setMaterials("ru-kk");
    const items = pickItems(all, all.filter((m) => fitsKind(m, "terms")).map((m) => m.id), "terms");
    const token = newReviewToken();
    const link = await store.createLink(
      {
        token_hash: hashReviewToken(token),
        pair: "ru-kk",
        kind: "terms",
        criteria: [...CRITERIA],
        ui_lang: "kk",
        reviewer_label: "А. К.",
        items_set: "pick:sets:1",
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      },
      items,
    );
    expect(link).not.toHaveProperty("token_hash");
    expect(link.kind).toBe("terms");
    const found = await store.findByHash(hashReviewToken(token));
    expect(found?.id).toBe(link.id);
    const b = await store.bundle(found!);
    expect(b.items.map((i) => i.model_text)).toEqual(items.map((i) => i.model_text));

    const first = b.items[0]!;
    const n = first.focus_terms!.length;
    const terms = Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i), { ok: i !== 1, fix: i === 1 ? "Әжеміз" : null }]));
    const saved = await store.saveFeedback(link.id, { item_id: first.id, paragraph: -1, edited_text: null, ratings: {}, comment: null, skipped: false, terms });
    expect(saved).toBe(true);
    expect(await store.saveFeedback(link.id, { item_id: "00000000-0000-0000-0000-000000000000", paragraph: -1, edited_text: null, ratings: {}, comment: null, skipped: false, terms: null })).toBe(false);

    const after = await store.bundle(link);
    expect(after.feedback[0]!.terms["1"]).toEqual({ ok: false, fix: "Әжеміз" });
    expect(itemState("terms", { id: first.id, targets: [], termCount: n }, after.feedback)).toBe("done");

    await store.complete(link.id);
    await store.revoke(link.id);
    const [l] = await store.links();
    expect(l!.completed_at).toBeTruthy();
    expect(l!.revoked_at).toBeTruthy();
  });
});
