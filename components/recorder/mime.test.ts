import { describe, expect, it } from "vitest";
import { blobType, formatTime, isAppleWebKit, pickMime } from "./mime";

const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  android: "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36",
  desktopChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
};

describe("выбор формата записи", () => {
  it("узнаёт WebKit на iPhone, iPad и Chrome для iOS", () => {
    expect(isAppleWebKit(UA.iphone)).toBe(true);
    expect(isAppleWebKit(UA.iphoneChrome)).toBe(true);
    expect(isAppleWebKit(UA.ipad, 5)).toBe(true);
    expect(isAppleWebKit(UA.android)).toBe(false);
    expect(isAppleWebKit(UA.desktopChrome)).toBe(false);
  });

  it("Safari → audio/mp4 даже если умеет webm", () => {
    const all = () => true;
    expect(pickMime(all, true)).toMatch(/^audio\/mp4/);
  });

  it("#66 Chrome с AAC (Android, 126+) → mp4/AAC: такую запись играет iPhone", () => {
    const chrome = (m: string) => m.startsWith("audio/webm") || m.startsWith("audio/mp4");
    expect(pickMime(chrome, false)).toBe("audio/mp4;codecs=mp4a.40.2");
  });

  it("Chrome / Chromium без AAC (mp4 только с Opus) → webm/opus, как раньше", () => {
    // так отвечает Chromium без проприетарных кодеков: голое audio/mp4 = Opus в mp4, iOS < 17 его не играет
    const chromium = (m: string) => m.startsWith("audio/webm") || m === "audio/mp4" || m === "audio/mp4;codecs=opus";
    expect(pickMime(chromium, false)).toBe("audio/webm;codecs=opus");
  });

  it("Firefox → webm/opus", () => {
    const firefox = (m: string) => m.startsWith("audio/webm") || m.startsWith("audio/ogg");
    expect(pickMime(firefox, false)).toBe("audio/webm;codecs=opus");
  });

  it("старый Safari без кодеков в строке → audio/mp4", () => {
    expect(pickMime((m) => m === "audio/mp4", true)).toBe("audio/mp4");
  });

  it("ничего не поддерживается → пусто, браузер выберет сам", () => {
    expect(pickMime(() => false, false)).toBe("");
  });

  it("тип блоба без кодека и с запасным значением", () => {
    expect(blobType("audio/webm;codecs=opus", false)).toBe("audio/webm");
    expect(blobType("audio/mp4;codecs=mp4a.40.2", false)).toBe("audio/mp4");
    expect(blobType("", true)).toBe("audio/mp4");
    expect(blobType("", false)).toBe("audio/webm");
  });

  it("таймер", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(65.7)).toBe("1:05");
    expect(formatTime(300)).toBe("5:00");
  });
});
