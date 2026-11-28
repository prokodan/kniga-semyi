// #340: экран ожидания главы — докупленный третий язык называется рядом со вторым; два языка — как было.
import { describe, expect, it } from "vitest";
import { extraTargets } from "./StoryWaiting";

describe("экран ожидания: языки перевода (#340)", () => {
  it("RU + KR, RU + KZ, только RU и без языков — без изменений (null → прежние подписи)", () => {
    expect(extraTargets(["ru", "ko"])).toBeNull();
    expect(extraTargets(["ru", "kk"])).toBeNull();
    expect(extraTargets(["ru"])).toBeNull();
    expect(extraTargets(undefined)).toBeNull();
  });

  it("докупленный язык — оба языка перевода", () => {
    expect(extraTargets(["ru", "ko", "kk"])).toBe("на корейский и казахский");
    expect(extraTargets(["ru", "kk", "ko"])).toBe("на казахский и корейский");
    expect(extraTargets(["ru", "ko", "ko"])).toBeNull();
  });
});
