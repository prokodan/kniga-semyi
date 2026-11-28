import { describe, expect, it } from "vitest";
import { applyLimit, copyLooksRight, decide, extOf, ffmpegArgs, playsOnOldIphone, SCHEDULED_MAX, uniqueRows, type StoredObject } from "./audio-plan";

const at = (iso: string, size = 1000): StoredObject => ({ updatedAt: iso, size });
const T1 = "2026-11-20T10:00:00Z";
const T2 = "2026-11-21T10:00:00Z";

describe("audio-plan: что делать с записью (#325)", () => {
  it("webm / ogg без копии → копия; с копией не старше оригинала → готово; оригинал новее → заново", () => {
    const objects = new Map([
      ["f/s/a.webm", at(T1)],
      ["f/s/b.webm", at(T1)],
      ["f/s/b.aac.m4a", at(T2)],
      ["_demo/roots.webm", at(T2)],
      ["_demo/roots.aac.m4a", at(T1)],
      ["f/s/c.ogg", at(T1)],
    ]);
    expect(decide("f/s/a.webm", objects)).toBe("convert");
    expect(decide("f/s/b.webm", objects)).toBe("copy_ok");
    expect(decide("_demo/roots.webm", objects)).toBe("stale");
    expect(decide("f/s/c.ogg", objects)).toBe("convert");
    expect(decide("f/s/gone.webm", objects)).toBe("missing");
  });

  it("mp3 / wav играют сразу; m4a / mp4 / 3gp — смотрим кодек", () => {
    const objects = new Map(["f/a.mp3", "f/b.wav", "f/c.m4a", "f/d.3gp"].map((p) => [p, at(T1)] as const));
    expect(decide("f/a.mp3", objects)).toBe("plays");
    expect(decide("f/b.wav", objects)).toBe("plays");
    expect(decide("f/c.m4a", objects)).toBe("probe");
    expect(decide("f/d.3gp", objects)).toBe("probe");
    expect(extOf("f.v/story")).toBe("");
  });

  it("AAC в mp4 играет на старом iPhone; Opus в mp4 (Chromium), AMR в 3gp, Opus в webm — нет", () => {
    const mp4 = "mov,mp4,m4a,3gp,3g2,mj2";
    expect(playsOnOldIphone({ format: mp4, codecs: ["aac"] })).toBe(true);
    expect(playsOnOldIphone({ format: "mp3", codecs: ["mp3"] })).toBe(true);
    expect(playsOnOldIphone({ format: mp4, codecs: ["opus"] })).toBe(false);
    expect(playsOnOldIphone({ format: mp4, codecs: ["amr_nb"] })).toBe(false);
    expect(playsOnOldIphone({ format: "matroska,webm", codecs: ["opus"] })).toBe(false);
    expect(playsOnOldIphone({ format: mp4, codecs: [] })).toBe(false);
  });

  it("копию проверяем перед загрузкой: AAC в mp4, не пустая, длительность близка к записанной", () => {
    const ok = { format: "mov,mp4,m4a,3gp,3g2,mj2", codecs: ["aac"], durationSec: 61.2 };
    expect(copyLooksRight(ok, 61).ok).toBe(true);
    expect(copyLooksRight(ok, null).ok).toBe(true);
    expect(copyLooksRight({ ...ok, durationSec: 20 }, 61).ok).toBe(false);
    expect(copyLooksRight({ ...ok, durationSec: 0 }, null).ok).toBe(false);
    expect(copyLooksRight({ ...ok, codecs: ["opus"] }, 61).ok).toBe(false);
  });

  it("ffmpeg: только аудио, AAC, moov в начале, mp4", () => {
    const a = ffmpegArgs("in.webm", "out.m4a");
    expect(a).toEqual(expect.arrayContaining(["-c:a", "aac", "+faststart", "mp4", "-vn"]));
    expect(a.at(-1)).toBe("out.m4a");
  });

  it("без повторов, без https и без самих копий", () => {
    const r = (path: string) => ({ storyId: path, familyId: "f", demo: false, path, durationSec: null });
    expect(uniqueRows([r("f/a.webm"), r("f/a.webm"), r("https://x/y.webm"), r("f/a.aac.m4a"), r("f/b.ogg")]).map((x) => x.path)).toEqual(["f/a.webm", "f/b.ogg"]);
  });

  it("предохранители: dry run, большой план по расписанию — только план, лимит ручного запуска", () => {
    expect(applyLimit({ apply: false, scheduled: false, todo: 3, max: 300 }).apply).toBe(false);
    expect(applyLimit({ apply: true, scheduled: true, todo: SCHEDULED_MAX + 1, max: 300 }).apply).toBe(false);
    expect(applyLimit({ apply: true, scheduled: true, todo: 5, max: 300 })).toEqual({ apply: true });
    expect(applyLimit({ apply: true, scheduled: false, todo: 500, max: 300 }).apply).toBe(true);
  });
});
