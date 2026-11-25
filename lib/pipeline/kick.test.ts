import { describe, expect, it } from "vitest";
import { cronAuthorized, kickAction, kickCause, kickFailedMessage, KICK_FAILED, KICK_MAX_ATTEMPTS } from "./kick-rule";

// #171: таймер Supabase → /api/cron/kick: те же правила, что у workflow kick-stuck
describe("kickAction", () => {
  const s = { id: "a", family_id: "f", status: "editing" as const };
  it("попыток меньше 3 → перезапуск, номер следующей", () => {
    expect(kickAction({ ...s, kick_attempts: 1 })).toEqual({ kind: "kick", tries: 1, of: KICK_MAX_ATTEMPTS });
  });
  it("3 попытки → failed", () => {
    expect(kickAction({ ...s, kick_attempts: 3 })).toEqual({ kind: "fail", tries: 3 });
  });
  it("поздняя попытка failed по перегрузке → перезапуск сверх 3", () => {
    expect(kickAction({ ...s, status: "failed", kick_attempts: 4, late: true })).toEqual({ kind: "kick", tries: 4, of: 9 });
  });
});

describe("kickFailedMessage", () => {
  it("начинается с метки поздних попыток, шаг и причина по-русски", () => {
    const m = kickFailedMessage("translating", 3, kickCause({ status: "rate_limited", error: null }));
    expect(m.startsWith(KICK_FAILED)).toBe(true);
    expect(m).toContain("3 попытки (шаг «перевод»): модели ИИ были перегружены");
  });
  it("нет записи об ошибке ИИ → шаг не успел запуститься", () => {
    expect(kickCause(null)).toBe("шаг не успел запуститься");
    expect(kickCause({ status: "timeout", error: null })).toBe("модель ИИ не ответила вовремя");
  });
});

describe("cronAuthorized", () => {
  it("верный Bearer-секрет → да", () => {
    expect(cronAuthorized("Bearer s3cret-value", "s3cret-value")).toBe(true);
  });
  it("неверный, другой длины, пустой или без Bearer → нет", () => {
    expect(cronAuthorized("Bearer s3cret-valuX", "s3cret-value")).toBe(false);
    expect(cronAuthorized("Bearer s", "s3cret-value")).toBe(false);
    expect(cronAuthorized(null, "s3cret-value")).toBe(false);
    expect(cronAuthorized("s3cret-value", "s3cret-value")).toBe(false);
  });
  it("секрет на сервере не задан → ручка закрыта даже для пустого заголовка", () => {
    expect(cronAuthorized("Bearer ", undefined)).toBe(false);
    expect(cronAuthorized(null, "")).toBe(false);
  });
});
