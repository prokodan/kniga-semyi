import { describe, expect, it } from "vitest";
import { copyNeedByHead, copyNeedByPath, transcodeInputs, transcodeTarget } from "./audio-copy";

const bytes = (...parts: string[]) => new Uint8Array(Buffer.from(parts.join(""), "latin1"));

describe("#347: нужна ли копия для iPhone сразу после загрузки", () => {
  it("по расширению", () => {
    expect(copyNeedByPath("fam/st/story-1.webm")).toBe("yes");
    expect(copyNeedByPath("fam/st/story-1.ogg")).toBe("yes");
    expect(copyNeedByPath("fam/st/story-1.opus")).toBe("yes");
    expect(copyNeedByPath("fam/st/story-1.m4a")).toBe("sniff");
    expect(copyNeedByPath("fam/st/story-1.mp4")).toBe("sniff");
    expect(copyNeedByPath("fam/st/story-1.mp3")).toBe("no");
    expect(copyNeedByPath("fam/st/story-1.wav")).toBe("no");
    expect(copyNeedByPath("fam/st/story-1.aac.m4a")).toBe("no"); // это сама копия
    expect(copyNeedByPath("https://example.com/a.webm")).toBe("no");
    expect(copyNeedByPath(null)).toBe("no");
  });

  it("по началу mp4: AAC (mp4a) — играет; Opus / AMR — копия; непонятно — копия (workflow проверит ffprobe)", () => {
    expect(copyNeedByHead(bytes("....ftypiso5....moov....stsd....mp4a....esds"))).toBe(false);
    expect(copyNeedByHead(bytes("....ftypiso5....moov....stsd....Opus....dOps"))).toBe(true);
    expect(copyNeedByHead(bytes("....ftyp3gp4....moov....stsd....samr"))).toBe(true);
    expect(copyNeedByHead(bytes("....ftypM4A ....mdat................"))).toBe(true);
  });

  it("прод → prod, превью → staging, локально / CI — не запускаем", () => {
    expect(transcodeTarget("production")).toBe("prod");
    expect(transcodeTarget("preview")).toBe("staging");
    expect(transcodeTarget("development")).toBeNull();
  });

  it("входы workflow: одна история, сразу apply", () => {
    expect(transcodeInputs("prod", "abc")).toEqual({ target: "prod", apply: "true", max: "1", story: "abc", comment: "" });
  });
});
