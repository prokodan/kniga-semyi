import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const fake = vi.hoisted(() => ({
  objects: new Set<string>(),
  calls: [] as string[][],
  batchFails: false,
}));
vi.mock("@/lib/db", async (orig) => {
  const real = await orig<typeof import("@/lib/db")>();
  const bucket = {
    createSignedUrls: async (paths: string[]) => {
      fake.calls.push(paths);
      if (fake.batchFails) return { data: null, error: { message: "boom" } };
      return {
        data: paths.map((p) => (fake.objects.has(p) ? { path: p, signedUrl: `https://sb/${p}?t=1`, error: null } : { path: p, signedUrl: null, error: "not found" })),
        error: null,
      };
    },
    createSignedUrl: async (p: string) =>
      fake.objects.has(p) ? { data: { signedUrl: `https://sb/${p}?one=1` }, error: null } : { data: null, error: { message: "not found" } },
  };
  return { ...real, getDbOrNull: () => ({ storage: { from: () => bucket } }) };
});

import { isPlayableCopy, playablePath } from "./playable";
import { playableSignedUrls } from "./chapter";

describe("путь копии для iPhone (#325)", () => {
  it("расширение оригинала → .aac.m4a рядом, в той же папке", () => {
    expect(playablePath("f/s/story-1.webm")).toBe("f/s/story-1.aac.m4a");
    expect(playablePath("f/s/story-1.m4a")).toBe("f/s/story-1.aac.m4a"); // Opus в mp4 из Chromium — тоже копия
    expect(playablePath("_demo/roots.ogg")).toBe("_demo/roots.aac.m4a");
    expect(playablePath("f/s.v2/story")).toBe("f/s.v2/story.aac.m4a"); // точка в папке — не расширение
  });

  it("копия, https-ссылка и пустое — без копии", () => {
    expect(playablePath("f/s/story-1.aac.m4a")).toBeNull();
    expect(playablePath("https://example.com/a.webm")).toBeNull();
    expect(playablePath(null)).toBeNull();
    expect(isPlayableCopy("f/s/story-1.AAC.M4A")).toBe(true);
    expect(isPlayableCopy("f/s/story-1.m4a")).toBe(false);
  });
});

describe("плеер берёт копию, если она есть (#325)", () => {
  it("есть копия → копия; нет → оригинал; нет файла → null; https → как есть; одним запросом", async () => {
    fake.objects = new Set(["f/s/a.webm", "f/s/a.aac.m4a", "f/s/b.m4a"]);
    fake.calls = [];
    fake.batchFails = false;
    const urls = await playableSignedUrls(["f/s/a.webm", "audio/f/s/b.m4a", "f/s/gone.webm", "https://x/y.mp3", null]);
    expect(urls).toEqual(["https://sb/f/s/a.aac.m4a?t=1", "https://sb/f/s/b.m4a?t=1", null, "https://x/y.mp3", null]);
    expect(fake.calls).toHaveLength(1);
  });

  it("пакет упал — по одной, оригиналы, как раньше", async () => {
    fake.objects = new Set(["f/s/a.webm", "f/s/a.aac.m4a"]);
    fake.batchFails = true;
    expect(await playableSignedUrls(["f/s/a.webm"])).toEqual(["https://sb/f/s/a.webm?one=1"]);
  });
});
