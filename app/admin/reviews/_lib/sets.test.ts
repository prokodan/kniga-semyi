// #232: носителям — только вымышленные тексты. Главы живых семей — никогда:
//   1) наборы собираются только из кода (демо, банк, прогоны eval по eval-персонажам), модули не читают базу;
//   2) каждый текст набора — персонаж eval, демо или вопрос банка;
//   3) ссылка создаётся только из набора (MemoryReviewStore: тексты ссылки = тексты набора).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REVIEW_EVAL_SETS } from "@/eval/reviews/sets";
import { listPersonas } from "@/eval/sim/persona";
import { DEMO_STORY_SEEDS } from "@/fixtures/demo/family";
import { REVIEW_PAIRS } from "@/lib/types";
import { hashReviewToken, newReviewToken } from "./core";
import { MemoryReviewStore } from "./repo";
import { REVIEW_SETS, findSet, setOptions } from "./sets";

const DIR = path.join(process.cwd(), "app/admin/reviews/_lib");
const EVAL_PERSONAS = new Set(listPersonas());
const DEMO = new Set(["demo:kim", "demo:li", "demo:reserve"]);
const BANK = new Set(["bank:koryo", "bank:general"]);

describe("наборы — только вымышленные тексты", () => {
  it("каждый текст — eval-персонаж, демо или банк", () => {
    for (const set of REVIEW_SETS) {
      for (const pair of REVIEW_PAIRS) {
        for (const item of set.items(pair)) {
          const ok = EVAL_PERSONAS.has(item.persona) || DEMO.has(item.persona) || BANK.has(item.persona);
          expect(ok, `${set.id} ${pair}: «${item.persona}» — не вымышленный персонаж`).toBe(true);
          expect(item.source_text.trim()).not.toBe("");
          expect(item.model_text.trim()).not.toBe("");
        }
      }
    }
  });

  it("наборы прогонов eval — только персонажи eval/personas", () => {
    for (const f of REVIEW_EVAL_SETS) for (const i of f.items) expect(EVAL_PERSONAS.has(i.persona), `${f.name}: ${i.persona}`).toBe(true);
  });

  it("Ким Чер Су из демо — персонаж eval (kim)", () => {
    expect(EVAL_PERSONAS.has("kim")).toBe(true);
  });

  it("модули наборов и ссылок не читают таблицы семей", () => {
    for (const f of ["sets.ts", "repo.ts", "store.ts"]) {
      const src = readFileSync(path.join(DIR, f), "utf8");
      expect(src, f).not.toMatch(/from\(\s*["'`](stories|story_texts|families|storytellers|books)["'`]/);
    }
    // наборы вообще не знают про базу
    expect(readFileSync(path.join(DIR, "sets.ts"), "utf8")).not.toMatch(/@\/lib\/db|supabase/i);
  });
});

describe("наборы для формы", () => {
  it("демо ru → ko: все главы семьи Ким + киоск + запас", () => {
    const demo = findSet("demo")!.items("ru-ko");
    expect(demo.length).toBeGreaterThanOrEqual(DEMO_STORY_SEEDS.length + 1);
    expect(demo[0]).toMatchObject({ kind: "chapter", source_lang: "ru", target_lang: "ko", persona: "demo:kim", position: 0 });
    expect(findSet("demo")!.items("ru-kk")).toEqual([]);
  });

  it("вопросы банка ru → ko есть; ru → kk пусто, пока нет текстов kk", () => {
    const ko = findSet("bank")!.items("ru-ko");
    expect(ko.length).toBeGreaterThanOrEqual(30);
    expect(ko.every((i) => i.kind === "question")).toBe(true);
    const opts = setOptions();
    expect(opts.find((o) => o.id === "bank" && o.pair === "ru-ko")?.count).toBe(ko.length);
    expect(opts.find((o) => o.id === "bank" && o.pair === "ru-kk")?.count).toBe(findSet("bank")!.items("ru-kk").length);
  });
});

describe("MemoryReviewStore", () => {
  it("ссылка = тексты набора; отзыв на чужой текст не пишется; хэш, не токен", async () => {
    const store = new MemoryReviewStore();
    const token = newReviewToken();
    const items = findSet("demo")!.items("ru-ko");
    const link = await store.createLink(
      { token_hash: hashReviewToken(token), pair: "ru-ko", mode: "texts", reviewer_label: "А. К.", items_set: "demo", expires_at: "2099-01-01T00:00:00Z" },
      items,
    );
    expect(JSON.stringify(link)).not.toContain(token);
    expect(link).not.toHaveProperty("token_hash");
    const found = await store.findByHash(hashReviewToken(token));
    expect(found?.id).toBe(link.id);
    const b = await store.bundle(found!);
    expect(b.items.map((i) => i.source_text)).toEqual(items.map((i) => i.source_text));

    const other = await store.createLink(
      { token_hash: "x", pair: "ru-ko", mode: "texts", reviewer_label: "Б.", items_set: "demo", expires_at: "2099-01-01T00:00:00Z" },
      items.slice(0, 1),
    );
    const foreign = (await store.bundle(other)).items[0]!.id;
    const input = { paragraph: -1, edited_text: null, ratings: { meaning: 5 }, comment: null, skipped: false };
    expect(await store.saveFeedback(link.id, { ...input, item_id: foreign })).toBe(false);
    expect(await store.saveFeedback(link.id, { ...input, item_id: b.items[0]!.id })).toBe(true);
    expect(await store.saveFeedback(link.id, { ...input, item_id: b.items[0]!.id, ratings: { meaning: 3 } })).toBe(true);
    const after = await store.bundle(link);
    expect(after.feedback).toHaveLength(1);
    expect(after.feedback[0]!.ratings).toEqual({ meaning: 3 });

    await store.revokeLink(link.id);
    expect((await store.findByHash(hashReviewToken(token)))?.revoked_at).not.toBeNull();
  });
});
