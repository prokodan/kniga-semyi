import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({})); // в тестах нет сборки Next с условием react-server
import { audioExt, audioPath, blockProgress, isOwnAudioPath, isTokenShape, MemoryFamilyStore, type StorySummary } from "./access";

const newFamily = {
  name: "Книга семьи Ким",
  gift_date: null,
  contact: null,
  storyteller: { name: "Бабушка Мария", name_ko: null, birth_year: 1941, birth_place: "Уштобе" },
  photo: null,
};

describe("доступ семьи по токену", () => {
  it("создаёт семью и находит её по токену из ссылки", async () => {
    const store = new MemoryFamilyStore();
    const { family, storyteller } = await store.createFamily(newFamily);
    expect(family.access_token).toMatch(/^[a-f0-9]{64}$/);
    const view = await store.getFamilyByToken(family.access_token);
    expect(view?.family.id).toBe(family.id);
    expect(view?.storyteller?.id).toBe(storyteller.id);
    expect(view?.storyteller?.consent_at).toBeNull();
  });

  it("неверный токен → null, а не ошибка", async () => {
    const store = new MemoryFamilyStore();
    await store.createFamily(newFamily);
    expect(await store.getFamilyByToken("abc")).toBeNull();
    expect(await store.getFamilyByToken("f".repeat(64))).toBeNull();
    expect(await store.getFamilyByToken("'; drop table families; --")).toBeNull();
    expect(isTokenShape("../etc")).toBe(false);
  });

  it("согласие и история попадают в семью", async () => {
    const store = new MemoryFamilyStore();
    const { family, storyteller } = await store.createFamily(newFamily);
    const consent = audioPath(family.id, storyteller.id, "consent", "audio/mp4");
    expect((await store.saveConsent(storyteller.id, consent)).consent_at).not.toBeNull();
    const story = await store.createStory(family.id, {
      storyteller_id: storyteller.id,
      audio_path: audioPath(family.id, storyteller.id, "story", "audio/webm;codecs=opus"),
      question_id: "roots-01",
      block: "roots",
      duration_sec: 42.5,
      session_id: null,
    });
    expect(story.status).toBe("uploaded");
    expect(story.audio_url).toMatch(/\.webm$/);
    const view = await store.getFamilyByToken(family.access_token);
    expect(view?.stories).toHaveLength(1);
  });
});

describe("пути аудио", () => {
  it("расширение по mime: Safari m4a, Chrome webm, диктофоны", () => {
    expect(audioExt("audio/mp4")).toBe("m4a");
    expect(audioExt("audio/webm;codecs=opus")).toBe("webm");
    expect(audioExt("audio/x-m4a")).toBe("m4a");
    expect(audioExt("audio/mpeg")).toBe("mp3");
    expect(audioExt("image/png")).toBeNull();
  });

  it("неподходящий формат → понятная ошибка", () => {
    expect(() => audioPath("f", "s", "story", "text/plain")).toThrow(/формат/);
  });

  it("путь только своей семьи, своего рассказчика и своего вида", () => {
    const p = audioPath("fam-1", "st-1", "story", "audio/mp4");
    expect(isOwnAudioPath(p, "fam-1", "st-1", "story")).toBe(true);
    expect(isOwnAudioPath(p, "fam-1", "st-1", "consent")).toBe(false);
    expect(isOwnAudioPath(p, "fam-2", "st-1")).toBe(false);
    expect(isOwnAudioPath("fam-1/st-1/../../fam-2/x/story-1.m4a", "fam-1", "st-1")).toBe(false);
  });
});

describe("прогресс «3 из 8»", () => {
  const s = (block: string | null, status: StorySummary["status"] = "uploaded", storyteller_id = "st-1"): StorySummary => ({
    id: Math.random().toString(),
    storyteller_id,
    question_id: null,
    block: block as StorySummary["block"],
    status,
    created_at: "",
  });

  it("считает блоки, а не истории; упавшие и чужие не считаются", () => {
    const p = blockProgress([s("roots"), s("roots"), s("love"), s("work", "failed"), s("youth", "ready", "st-2"), s(null)], "st-1");
    expect(p.done).toBe(2);
    expect(p.total).toBe(8);
    expect(p.stories).toBe(4);
    expect(p.covered).toEqual(["roots", "love"]);
  });
});
