// #200: «Архив» и «▶ Показ» киоска — только семьи киоска с archive_consent, без токенов, ссылок с токеном и голоса.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { buildShow, pickShowRows } from "./archive";
import type { Family, Story, Storyteller } from "@/lib/types";

const fam = (id: string, over: Partial<Family> = {}) =>
  ({
    id,
    name: `Семья ${id}`,
    access_token: `tok-${id}`,
    source: "kiosk",
    archive_consent: true,
    is_demo: false,
    created_at: "2026-11-20T10:00:00Z",
    ...over,
  }) as Family;
const st = (family_id: string, name: string) =>
  ({ id: `st-${family_id}`, family_id, name, name_ko: null, birth_year: 1938, birth_place: "Уштобе", created_at: "2026-11-20T10:00:00Z" }) as Storyteller;
const story = (id: string, family_id: string, block: string, created_at: string, over: Partial<Story> = {}) =>
  ({
    id,
    family_id,
    storyteller_id: `st-${family_id}`,
    block,
    title: `Глава ${id}`,
    title_ko: `장 ${id}`,
    quote: "Помню как вчера",
    quote_ko: "어제 일처럼 기억난다",
    text_ru: `Текст ${id}`,
    text_ko: `본문 ${id}`,
    audio_url: `audio/${id}.m4a`,
    status: "ready",
    parent_story_id: null,
    created_at,
    ...over,
  }) as unknown as Story;

describe("архив киоска", () => {
  const all = {
    families: [
      fam("k1", { created_at: "2026-11-21T10:00:00Z" }),
      fam("demo", { is_demo: true }),
      fam("noconsent", { archive_consent: false }),
      fam("family", { source: "family" as Family["source"] }),
    ],
    storytellers: [st("k1", "Пак Анна"), st("demo", "Ли Нина"), st("noconsent", "Скрытая"), st("family", "Из дома")],
    stories: [
      story("c2", "k1", "work", "2026-11-21T11:00:00Z"),
      story("c1", "k1", "roots", "2026-11-21T12:00:00Z"),
      story("draft", "k1", "love", "2026-11-21T13:00:00Z", { status: "editing" } as Partial<Story>),
      story("fu", "k1", "love", "2026-11-21T14:00:00Z", { parent_story_id: "c1" } as Partial<Story>),
      story("d1", "demo", "childhood", "2026-11-20T11:00:00Z"),
      story("x", "noconsent", "roots", "2026-11-20T11:00:00Z"),
      story("y", "family", "roots", "2026-11-20T11:00:00Z"),
    ],
  };
  const show = buildShow(pickShowRows(all));

  it("только киоск + archive_consent, демо — да; по времени создания", () => {
    expect(show.map((f) => f.name)).toEqual(["Ли Нина", "Пак Анна"]);
  });

  it("главы: только готовые основные, по карте жизни, RU и KR", () => {
    const k1 = show.find((f) => f.id === "k1")!;
    expect(k1.chapters.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(k1.chapters[0]).toMatchObject({ title: "Глава c1", titleKo: "장 c1", textRu: "Текст c1", textKo: "본문 c1", quoteKo: "어제 일처럼 기억난다" });
    expect(k1).toMatchObject({ birthYear: 1938, birthPlace: "Уштобе", isDemo: false });
  });

  it("никаких токенов, ссылок с токеном и голоса", () => {
    const json = JSON.stringify(show);
    expect(json).not.toMatch(/tok-|access_token|\/f\/|\/book\/|\/chapter\/|\/draft|token=|audio|listen/);
  });

  it("семья без готовых глав не показывается", () => {
    expect(buildShow(pickShowRows({ ...all, stories: [] }))).toEqual([]);
  });
});
