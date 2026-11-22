// Витрина «Архив АКНЦ»: только семьи с archive_consent, порядок глав по карте жизни, ссылки на книгу, главу и голос.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { buildArchive } from "./archive";
import { verifyListen } from "@/lib/book/qr";

const fam = (id: string, over: Partial<{ is_demo: boolean; created_at: string }> = {}) => ({
  id,
  name: `Семья ${id}`,
  access_token: `tok-${id}`,
  is_demo: false,
  created_at: "2026-11-20T10:00:00Z",
  ...over,
});
const story = (id: string, family_id: string, block: string, created_at: string, audio = true) => ({
  id,
  family_id,
  block: block as never,
  title: `Глава ${id}`,
  title_ko: null,
  quote: "Помню как вчера",
  duration_sec: 300,
  audio_url: audio ? `audio/${id}.m4a` : null,
  created_at,
});

describe("buildArchive", () => {
  const rows = {
    families: [fam("b", { created_at: "2026-11-21T10:00:00Z" }), fam("demo", { is_demo: true })],
    storytellers: [{ family_id: "b", name: "Ли Нина", name_ko: "이니나", birth_year: 1938, birth_place: "Уштобе", created_at: "2026-11-21T10:00:00Z" }],
    stories: [
      story("s-work", "b", "work", "2026-11-21T09:00:00Z"),
      story("s-child-2", "b", "childhood", "2026-11-21T12:00:00Z", false),
      story("s-child-1", "b", "childhood", "2026-11-21T11:00:00Z"),
    ],
    books: [{ family_id: "b", status: "ready" as const, page_count: 24, created_at: "2026-11-21T13:00:00Z" }],
  };

  it("главы по разделам, ссылки на книгу, главу и подписанный голос", () => {
    const [b] = buildArchive(rows, { hideDemo: true });
    expect(b!.bookHref).toBe("/book/tok-b");
    expect(b!.book).toEqual({ status: "ready", pages: 24 });
    expect(b!.storyteller?.name).toBe("Ли Нина");
    expect(b!.chapters.map((c) => c.id)).toEqual(["s-child-1", "s-child-2", "s-work"]);
    expect(b!.chapters[0]!.section).toBe("Детство");
    expect(b!.chapters[0]!.chapterHref).toBe("/chapter/s-child-1?token=tok-b");
    const voice = new URL(b!.chapters[0]!.voiceHref!, "http://x");
    expect(voice.pathname).toBe("/listen/s-child-1");
    expect(verifyListen("s-child-1", voice.searchParams.get("s"))).toBe(true);
    expect(b!.chapters[1]!.voiceHref).toBeNull();
    expect(b!.chapters[0]!.minutes).toBe(5);
  });

  it("демо-семьи скрываются фильтром", () => {
    expect(buildArchive(rows).map((f) => f.id)).toEqual(["demo", "b"]);
    expect(buildArchive(rows, { hideDemo: true }).map((f) => f.id)).toEqual(["b"]);
  });
});
