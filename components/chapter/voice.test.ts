// Пункт 2: голос главы — несколько записей подряд; перемотка по всей главе попадает в нужную запись.
import { describe, expect, it } from "vitest";
import { locate } from "./VoicePlayer";

describe("плеер главы: части", () => {
  const d = [22.6, 40.3, 27.9, 30.9]; // «первый велосипед»: основной ответ + 3 уточнения
  it("позиция внутри первой записи", () => expect(locate(d, 10)).toEqual({ index: 0, offset: 10 }));
  it("23-я секунда — уже вторая запись, а не конец главы", () => {
    const r = locate(d, 23);
    expect(r.index).toBe(1);
    expect(r.offset).toBeCloseTo(0.4);
  });
  it("в самом конце — последняя запись", () => expect(locate(d, 121.7).index).toBe(3));
  it("одна запись", () => expect(locate([30], 12)).toEqual({ index: 0, offset: 12 }));
});
