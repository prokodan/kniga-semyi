import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { getFamilyStore, MemoryFamilyStore } from "@/lib/db/access";
import { audioStoragePath, lifeYears, loadChapter } from "./chapter";

async function seed() {
  const store = getFamilyStore() as MemoryFamilyStore;
  const { family, storyteller } = await store.createFamily({
    name: "Книга семьи Пак",
    gift_date: null,
    contact: null,
    storyteller: { name: "Дедушка Николай", name_ko: "박 니콜라이", birth_year: 1938, birth_place: "Кзыл-Орда" },
    photo: null,
  });
  const story = await store.createStory(family.id, {
    storyteller_id: storyteller.id,
    audio_path: `${family.id}/${storyteller.id}/story-1.m4a`,
    question_id: "roots-01",
    block: "roots",
    duration_sec: 61,
    session_id: null,
    parent_story_id: null,
  });
  return { family, storyteller, story };
}

describe("данные главы (локальный режим без Supabase)", () => {
  it("по токену семьи — история, рассказчик и семья", async () => {
    const { family, story } = await seed();
    const data = await loadChapter(story.id, { token: family.access_token });
    expect(data?.story.id).toBe(story.id);
    expect(data?.storyteller?.name_ko).toBe("박 니콜라이");
    expect(data?.family.name).toBe("Книга семьи Пак");
  });

  it("чужой или кривой токен → null; без токена (проверена подпись QR) → данные", async () => {
    const { story } = await seed();
    const other = await seed();
    expect(await loadChapter(story.id, { token: other.family.access_token })).toBeNull();
    expect(await loadChapter(story.id, { token: "nope" })).toBeNull();
    expect(await loadChapter("'; drop table stories; --")).toBeNull();
    expect((await loadChapter(story.id))?.story.id).toBe(story.id);
  });

  it("годы жизни и путь аудио в бакете", () => {
    expect(lifeYears({ birth_year: 1938, death_year: null })).toBe("1938 г. р.");
    expect(lifeYears({ birth_year: 1938, death_year: 2020 })).toBe("1938–2020");
    expect(lifeYears(null)).toBeNull();
    expect(audioStoragePath("audio/f/s/story-1.m4a")).toBe("f/s/story-1.m4a");
    expect(audioStoragePath("/f/s/story-1.m4a")).toBe("f/s/story-1.m4a");
  });
});
