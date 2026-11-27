// #223: флаги функций — окружение (Production / Preview / локально), FLAGS_ON, выкатка по семьям (labs).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanLabs, envFlags, flagsOnEnv, isOn, toggleLab, valuesFor } from "./core";
import { FLAG_NAMES, FLAGS, isFlagName } from "./registry";
import { isFlagOn } from "./shared";

vi.mock("server-only", () => ({}));

describe("реестр", () => {
  it("demo_flag есть, у каждого флага описание, владелец и issue", () => {
    expect(FLAG_NAMES).toContain("demo_flag");
    for (const n of FLAG_NAMES) {
      const f = FLAGS[n];
      expect(f.description.length).toBeGreaterThan(10);
      expect(["Данил", "Влад"]).toContain(f.owner);
      expect(f.issue).toBeGreaterThan(0);
      expect(n).toMatch(/^[a-z][a-z0-9_]*$/);
    }
    expect(isFlagName("demo_flag")).toBe(true);
    expect(isFlagName("toString")).toBe(false);
    expect(isFlagName("нет_такого")).toBe(false);
  });
});

describe("окружение", () => {
  it("Production без FLAGS_ON — выключен", () => {
    const e = envFlags("production", undefined);
    expect(isOn("demo_flag", e)).toBe(false);
    expect(flagsOnEnv(e)).toEqual([]);
    expect(isOn("demo_flag", envFlags("production", "  "))).toBe(false);
  });

  it("Preview: FLAGS_ON=* и без переменной — включён", () => {
    expect(isOn("demo_flag", envFlags("preview", "*"))).toBe(true);
    expect(isOn("demo_flag", envFlags("preview", undefined))).toBe(true);
  });

  it("локально / в тестах без переменной — включены все", () => {
    expect(flagsOnEnv(envFlags("development", undefined))).toEqual(FLAG_NAMES);
  });

  it("FLAGS_ON — список имён; чужие имена не включают ничего", () => {
    expect(isOn("demo_flag", envFlags("production", "x, demo_flag"))).toBe(true);
    expect(isOn("demo_flag", envFlags("preview", "other_flag"))).toBe(false);
    expect(isOn("demo_flag", envFlags("development", "other_flag"))).toBe(false);
  });
});

describe("выкатка по семьям (families.labs)", () => {
  const prod = envFlags("production", undefined);

  it("в Production включён только семье с именем в labs", () => {
    expect(isOn("demo_flag", prod, { familyId: "f1", labs: ["demo_flag"] })).toBe(true);
    expect(isOn("demo_flag", prod, { familyId: "f2", labs: [] })).toBe(false);
    expect(isOn("demo_flag", prod, { familyId: "f3", labs: null })).toBe(false);
    expect(isOn("demo_flag", prod, { familyId: "f4" })).toBe(false);
  });

  it("значения для клиентского компонента", () => {
    const v = valuesFor(prod, { labs: ["demo_flag"] });
    expect(v.demo_flag).toBe(true);
    expect(isFlagOn(v, "demo_flag")).toBe(true);
    expect(isFlagOn(valuesFor(prod), "demo_flag")).toBe(false);
    expect(isFlagOn(null, "demo_flag")).toBe(false);
  });

  it("переключатель labs: добавляет / убирает, чужие имена не трогает", () => {
    expect(toggleLab([], "demo_flag", true)).toEqual(["demo_flag"]);
    expect(toggleLab(["demo_flag", "z_old"], "demo_flag", true)).toEqual(["demo_flag", "z_old"]);
    expect(toggleLab(["demo_flag", "z_old"], "demo_flag", false)).toEqual(["z_old"]);
    expect(toggleLab(null, "demo_flag", false)).toEqual([]);
    expect(cleanLabs(["z_old", "demo_flag", "demo_flag"])).toEqual(["demo_flag"]);
  });
});

describe("flag() читает окружение", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("VERCEL_ENV=production → выключен, labs → включён; preview → включён", async () => {
    const { flag, flagsOn } = await import("./index");
    process.env.VERCEL_ENV = "production";
    delete process.env.FLAGS_ON;
    expect(flag("demo_flag")).toBe(false);
    expect(flagsOn()).toEqual([]);
    expect(flag("demo_flag", { labs: ["demo_flag"] })).toBe(true);
    process.env.VERCEL_ENV = "preview";
    process.env.FLAGS_ON = "*";
    expect(flag("demo_flag")).toBe(true);
    expect(flagsOn()).toEqual(FLAG_NAMES);
  });
});
