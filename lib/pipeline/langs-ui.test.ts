// #299: подписи интерфейса по языкам книги. Книга RU + KR — строки байт в байт как до #299.
import { describe, expect, it } from "vitest";
import { consentText } from "@/app/(family)/consent/[token]/text";
import { DEFAULT_BOOK_LANGS } from "@/lib/types";
import { bookLangsPhrase, LANG_UI, langUi, secondLang, translatingMessage, translatingStep } from "./langs";

// Тексты до #299 — снимок main 6968fab (consent/text.ts, engine.ts STATUS_MESSAGE, StoryWaiting, QrCode, /listen, /book)
const BEFORE = {
  consent:
    "Я, Анна, согласен (согласна), чтобы мои рассказы записывали для книги нашей семьи. " +
    "Я знаю, что запись голоса обрабатывают внешние сервисы искусственного интеллекта — они переводят речь в текст " +
    "и помогают с переводом на корейский. Записи и книгу видит только наша семья.",
  translating: "Переводим главу на корейский…",
  step: "Переводим на корейский",
  qr: "카메라를 대면 목소리를 들을 수 있어요",
  footer: "손주들을 위한 가족의 이야기",
  tagline: "우리 이야기",
  book: "на русском и корейском",
};

describe("книга RU + KR — как до #299", () => {
  it("согласие: по умолчанию и с языками ru,ko — тот же текст", () => {
    expect(consentText("Анна")).toBe(BEFORE.consent);
    expect(consentText("Анна", ["ru", "ko"])).toBe(BEFORE.consent);
  });
  it("перевод, QR, подвал, подпись книги", () => {
    expect(translatingMessage(DEFAULT_BOOK_LANGS)).toBe(BEFORE.translating);
    expect(translatingStep(DEFAULT_BOOK_LANGS)).toBe(BEFORE.step);
    expect(LANG_UI.ko.qr).toBe(BEFORE.qr);
    expect(LANG_UI.ko.listenFooter).toBe(BEFORE.footer);
    expect(LANG_UI.ko.tagline).toBe(BEFORE.tagline);
    expect(bookLangsPhrase(DEFAULT_BOOK_LANGS)).toBe(BEFORE.book);
  });
});

describe("книга RU + KZ", () => {
  const kk = ["ru", "kk"] as const;
  it("второй язык — казахский, без корейского", () => {
    expect(secondLang(kk)).toBe("kk");
    expect(consentText("Гүлнар", kk)).toContain("помогают с переводом на казахский.");
    expect(consentText("Гүлнар", kk)).not.toMatch(/корейск/);
    expect(translatingMessage(kk)).toBe("Переводим главу на казахский…");
    expect(translatingStep(kk)).toBe("Переводим на казахский");
    expect(bookLangsPhrase(kk)).toBe("на русском и казахском");
  });
  it("нет казахской строки — нет и корейской (QR, подвал, подпись — до носителя #295)", () => {
    expect(langUi(kk)?.qr).toBeNull();
    expect(langUi(kk)?.listenFooter).toBeNull();
    expect(langUi(kk)?.tagline).toBeNull();
  });
});

describe("книга только RU", () => {
  const ru = ["ru"] as const;
  it("без перевода и без второго языка", () => {
    expect(secondLang(ru)).toBeNull();
    expect(langUi(ru)).toBeNull();
    const text = consentText("Галина", ru);
    expect(text).not.toMatch(/с переводом|корейск|казахск/);
    expect(text).toContain("они переводят речь в текст. Записи и книгу видит только наша семья.");
    expect(translatingStep(ru)).toBeNull();
    expect(translatingMessage(ru)).not.toMatch(/корейск/);
    expect(bookLangsPhrase(ru)).toBe("на русском");
  });
});
