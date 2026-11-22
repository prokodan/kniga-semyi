// #56: 5 неверных PIN за 10 минут с одного IP → вход закрыт, понятное сообщение; верный PIN сбрасывает счётчик.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { clientIp, limitFrom, lockedMessage, PIN_WINDOW_MS, tryAdminPin } from "./attempts";

const T = Date.parse("2026-11-25T10:00:00Z");
const min = 60_000;

describe("limitFrom", () => {
  it("до 5 неудач — можно, 5-я закрывает до выхода самой старой из окна", () => {
    expect(limitFrom([T - 3 * min, T - 2 * min], T)).toEqual({ allowed: true, left: 3, retryAt: null });
    const five = [1, 2, 3, 4, 5].map((i) => T - (10 - i) * min);
    const l = limitFrom(five, T);
    expect(l.allowed).toBe(false);
    expect(l.retryAt!.getTime()).toBe(five[0]! + PIN_WINDOW_MS);
    expect(lockedMessage(l, new Date(T))).toBe("Слишком много неверных попыток. Вход закрыт на 1 мин — попробуйте позже.");
    // старые неудачи за окном не считаются
    expect(limitFrom([T - 11 * min, T - 12 * min, T - 13 * min, T - 14 * min, T - 15 * min], T).allowed).toBe(true);
  });

  it("IP — первый адрес x-forwarded-for", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientIp(new Headers({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("tryAdminPin (память, без Supabase)", () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  const run = async (input: string, ip: string) => {
    const p = tryAdminPin(input, ip, (x) => x === "246810");
    await vi.runAllTimersAsync();
    return p;
  };

  it("5 неверных → 429 и вход закрыт даже с верным PIN; другой IP не задет", async () => {
    const ip = "9.9.9.1";
    for (let i = 1; i <= 4; i++) expect(await run("0000", ip)).toMatchObject({ ok: false, status: 401 });
    const fifth = await run("0000", ip);
    expect(fifth).toMatchObject({ ok: false, status: 429 });
    expect((fifth as { message: string }).message).toMatch(/Слишком много неверных попыток/);
    expect(await run("246810", ip)).toMatchObject({ ok: false, status: 429 });
    expect(await run("246810", "9.9.9.2")).toEqual({ ok: true });
  });

  it("предупреждает, когда осталось мало попыток; верный PIN обнуляет счётчик", async () => {
    const ip = "9.9.9.3";
    await run("1", ip);
    await run("2", ip);
    const third = await run("3", ip);
    expect(third).toMatchObject({ status: 401, left: 2 });
    expect((third as { message: string }).message).toMatch(/Осталось попыток: 2/);
    expect(await run("246810", ip)).toEqual({ ok: true });
    expect(await run("4", ip)).toMatchObject({ status: 401, left: 4, message: "PIN не подошёл" });
  });
});
