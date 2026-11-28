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

/** sha256 PDF кода main (до #340). "" — эталона нет: тест только печатает хэш. */
const GOLDEN = {
  demo: "",
  kiosk: "",
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
