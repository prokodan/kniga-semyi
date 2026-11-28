// #340: книга RU + KR не меняется ни на байт. Эталон — sha256 PDF демо-книг, собранных кодом main до #340
// (первый коммит PR печатает хэши в лог CI, «[book-golden]», и они записаны сюда). Дата создания PDF (CreationDate,
// от неё же ID файла) — фиксированная: иначе каждый рендер отличается ровно в этих байтах.
// Поменяли вёрстку RU + KR сознательно — обновите хэши из лога этого теста и напишите об этом в PR.
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_BOOK, DEMO_KIOSK_BOOK } from "./demo";
import { renderBook } from "./render";

const voiceUrl = (id: string) => `https://kniga.example/listen/${id}?s=AAAAAAAAAAAAAAAAAAAAAA`;
const NOW = new Date("2026-11-28T00:00:00Z");
const BUILT = new Date("2026-11-27T00:00:00Z");

/** sha256 PDF кода main до #340 (main 00ddbfc, прогон ci PR #370, коммит 7682774). "" — эталона нет: только печать. */
const GOLDEN = {
  demo: "af19678e453f96fa87aee126049be7cf654d64a260131d1cc78865e986013ed9",
  kiosk: "b2898818355b7a9ca11a30163529e0fc526f97207cd18e2ae440cb45a7256165",
};

async function sha(input: Parameters<typeof renderBook>[0]): Promise<string> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  const r = await renderBook(input);
  return createHash("sha256").update(r.pdf).digest("hex");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("PDF RU + KR — байт в байт как в main (#340)", () => {
  it("демо Ким: ru,ko", async () => {
    const a = await sha({ ...DEMO_BOOK, voiceUrl, builtAt: BUILT, langs: ["ru", "ko"] });
    const b = await sha({ ...DEMO_BOOK, voiceUrl, builtAt: BUILT }); // языки не заданы = ru, ko
    console.info(`[book-golden] demo ${a}`);
    expect(b).toBe(a);
    if (GOLDEN.demo) expect(a).toBe(GOLDEN.demo);
  }, 60_000);

  it("книга киоска «Ли Нина»: ru,ko", async () => {
    const a = await sha({ ...DEMO_KIOSK_BOOK, voiceUrl, builtAt: BUILT, langs: ["ru", "ko"] });
    console.info(`[book-golden] kiosk ${a}`);
    if (GOLDEN.kiosk) expect(a).toBe(GOLDEN.kiosk);
  }, 60_000);
});
