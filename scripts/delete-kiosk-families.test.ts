// #201: скрипт удаления отказывается трогать демо и семьи /start; файлы — только из папки семьи.
import { describe, expect, it } from "vitest";
import { DEMO_FAMILY, DEMO_KIOSK_FAMILY } from "@/fixtures/demo/family";
import { ownPaths, parsePrefixes, selectFamilies, type FamilyRow } from "./delete-kiosk-families.plan";

const AT = "2026-11-24T10:00:00Z";
const fam = (id: string, source: FamilyRow["source"], is_demo = false): FamilyRow => ({ id, source, is_demo, created_at: AT });

const all: FamilyRow[] = [
  fam("19b31d8c-0000-4000-8000-000000000001", "kiosk"),
  fam("aa41aa7c-0000-4000-8000-000000000002", "kiosk"),
  fam("bbbbbbbb-0000-4000-8000-000000000003", "family"),
  fam("cccccccc-0000-4000-8000-000000000004", "kiosk", true),
  fam("dddddddd-0000-4000-8000-000000000005", "kiosk"),
  fam("dddddddd-1111-4000-8000-000000000006", "kiosk"),
  fam(DEMO_KIOSK_FAMILY.id, "kiosk"), // даже если бы флажок is_demo слетел
  fam(DEMO_FAMILY.id, "family", true),
];

describe("delete-kiosk-families: отбор", () => {
  it("две тестовые семьи киоска из #201 — к удалению", () => {
    const s = selectFamilies(parsePrefixes("19b31d8c, aa41aa7c"), all);
    expect(s.refused).toEqual([]);
    expect(s.families.map((f) => f.id.slice(0, 8))).toEqual(["19b31d8c", "aa41aa7c"]);
  });

  it("отказ: демо, семья /start, неизвестный, неоднозначный, короткий, all", () => {
    const s = selectFamilies(parsePrefixes("cccccccc,bbbbbbbb,eeeeeeee,dddddddd,19b3,all"), all);
    expect(s.refused.map((r) => [r.prefix, r.reason.split(" ")[0]])).toEqual([
      ["cccccccc", "демо-семья"],
      ["bbbbbbbb", "семья"],
      ["eeeeeeee", "семья"],
      ["dddddddd", "совпадает"],
      ["19b3", "нужен"],
      ["all", "нужен"],
    ]);
    expect(s.refused[1]!.reason).toContain("source=family");
  });

  it("демо по фиксированному id защищено, даже без is_demo", () => {
    const s = selectFamilies([DEMO_KIOSK_FAMILY.id.toLowerCase()], all);
    expect(s.families).toEqual([]);
    expect(s.refused[0]!.reason).toMatch(/демо/);
  });

  it("пустой список — отказ", () => {
    expect(selectFamilies(parsePrefixes(" , "), all).refused).toHaveLength(1);
  });
});

describe("delete-kiosk-families: файлы", () => {
  it("только под папкой семьи; общие голоса демо и «..» не трогаем", () => {
    const id = "19b31d8c-0000-4000-8000-000000000001";
    expect(ownPaths(id, [`${id}/st/story-1.m4a`, `/${id}/kniga.pdf`, "_demo/consent.m4a", `${id}/../x`, null, `${id}/st/story-1.m4a`])).toEqual({
      own: [`${id}/kniga.pdf`, `${id}/st/story-1.m4a`],
      foreign: [`${id}/../x`, "_demo/consent.m4a"],
    });
  });
});
