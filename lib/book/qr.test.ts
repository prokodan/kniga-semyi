import { describe, expect, it } from "vitest";
import { listenPath, listenUrl, qrSvg, qrSvgFile, signListen, verifyListen } from "./qr";

const ID = "3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b";
const KEY = "test-secret";

describe("подпись ссылки на голос", () => {
  it("своя подпись проходит, длина 22 символа base64url", () => {
    const sig = signListen(ID, KEY);
    expect(sig).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(verifyListen(ID, sig, KEY)).toBe(true);
  });

  it("подпись открывает только эту историю", () => {
    const other = "3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5c";
    expect(verifyListen(other, signListen(ID, KEY), KEY)).toBe(false);
  });

  it("неверная, обрезанная, пустая подпись и чужой секрет → false", () => {
    const sig = signListen(ID, KEY);
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(verifyListen(ID, flipped, KEY)).toBe(false);
    expect(verifyListen(ID, sig.slice(0, 21), KEY)).toBe(false);
    expect(verifyListen(ID, "", KEY)).toBe(false);
    expect(verifyListen(ID, undefined, KEY)).toBe(false);
    expect(verifyListen(ID, "../../etc/passwd/xxxxxx", KEY)).toBe(false);
    expect(verifyListen(ID, sig, "другой секрет")).toBe(false);
  });

  it("без явного секрета работает и в локальном режиме", () => {
    expect(verifyListen(ID, signListen(ID))).toBe(true);
  });

  it("ссылка /listen/<id>?s=…, origin без лишнего слэша", () => {
    expect(listenPath(ID, KEY)).toBe(`/listen/${ID}?s=${signListen(ID, KEY)}`);
    expect(listenUrl("https://kniga.example/", ID, KEY)).toBe(`https://kniga.example/listen/${ID}?s=${signListen(ID, KEY)}`);
  });
});

describe("QR", () => {
  it("SVG на странице: модули currentColor, прозрачный фон, подпись для экранного диктора", async () => {
    const svg = await qrSvg(listenUrl("https://kniga.example", ID, KEY));
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).toContain('fill="none"');
    expect(svg).not.toMatch(/#000000|#ffffff/i);
    expect(svg).toContain('role="img"');
  });

  it("файл для слайда — чёрный на белом, 1024 px", async () => {
    const svg = await qrSvgFile("https://kniga.example/listen/x?s=y");
    expect(svg).toContain('width="1024"');
    expect(svg).toMatch(/#000000/i);
  });
});
