import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { applyFilter, buildCounters, buildFamilies, buildVolunteers, filterFamilies, type CenterRows } from "./stats";

const since = new Date("2026-11-23T19:00:00Z"); // полночь 24.11 по Алматы
const OLD = "2026-11-20T10:00:00Z";
const NOW = "2026-11-24T05:00:00Z";

function rows(): CenterRows {
  return {
    families: [
      { id: "f1", name: "Ким", source: "kiosk", archive_consent: true, is_demo: false, created_at: NOW },
      { id: "f2", name: "Пак", source: "family", archive_consent: false, is_demo: false, created_at: OLD },
      { id: "f3", name: "Демо", source: "family", archive_consent: true, is_demo: true, created_at: OLD },
    ],
    storytellers: [
      { id: "s1", family_id: "f1", name: "Ким Анна", birth_year: 1940, consent_at: NOW, created_at: NOW },
      { id: "s2", family_id: "f2", name: "Пак Сергей", birth_year: 1938, consent_at: null, created_at: OLD },
      { id: "s3", family_id: "f3", name: "Демо", birth_year: null, consent_at: OLD, created_at: OLD },
    ],
    stories: [
      { family_id: "f1", status: "ready", parent_story_id: null, duration_sec: 120, created_at: NOW },
      { family_id: "f1", status: "ready", parent_story_id: "x", duration_sec: 30, created_at: NOW }, // уточнение
      { family_id: "f1", status: "editing", parent_story_id: null, duration_sec: 90, created_at: NOW },
      { family_id: "f2", status: "failed", parent_story_id: null, duration_sec: 60, created_at: OLD },
      { family_id: "f3", status: "ready", parent_story_id: null, duration_sec: 600, created_at: OLD },
    ],
    books: [
      { family_id: "f1", status: "failed", built_at: null, created_at: OLD },
      { family_id: "f1", status: "ready", built_at: NOW, created_at: NOW }, // последняя
      { family_id: "f3", status: "draft", built_at: null, created_at: OLD },
    ],
    sessions: [
      { family_id: "f1", volunteer_id: "v1", mode: "kiosk", started_at: NOW },
      { family_id: "f2", volunteer_id: null, mode: "family", started_at: OLD },
    ],
    volunteers: [
      { id: "v1", name: "Влад", active: true, created_at: OLD },
      { id: "v2", name: "Алия", active: false, created_at: OLD },
    ],
  };
}

describe("счётчики кабинета АКНЦ", () => {
  it("всего / сегодня; минуты — все записи, истории — без уточнений; книга — последняя", () => {
    const c = buildCounters(rows(), since);
    expect(c.families).toEqual({ total: 3, today: 1 });
    expect(c.kioskFamilies).toEqual({ total: 1, today: 1 });
    expect(c.elders).toEqual({ total: 3, today: 1 });
    expect(c.consented).toBe(2);
    expect(c.stories).toEqual({ total: 4, today: 2 });
    expect(c.readyStories).toEqual({ total: 2, today: 1 });
    expect(c.minutes).toEqual({ total: 15, today: 4 }); // (120+30+90+60+600)/60 и (120+30+90)/60
    expect(c.books).toEqual({ none: 1, draft: 1, building: 0, ready: 1, failed: 0 });
    expect(c.booksBuiltToday).toBe(1);
    expect(c.archive).toBe(2);
  });

  it("фильтр скрывает демо-семьи из всех счётчиков", () => {
    const c = buildCounters(applyFilter(rows(), { hideDemo: true }), since);
    expect(c.families.total).toBe(2);
    expect(c.minutes.total).toBe(5);
    expect(c.archive).toBe(1);
    expect(c.books.draft).toBe(0);
  });

  it("пустая база — нули, без падений", () => {
    const empty: CenterRows = { families: [], storytellers: [], stories: [], books: [], sessions: [], volunteers: [] };
    const c = buildCounters(empty, since);
    expect(c.minutes).toEqual({ total: 0, today: 0 });
    expect(buildFamilies(empty)).toEqual([]);
  });
});

describe("список семей и волонтёры", () => {
  it("источник, рассказчики, истории, статус книги; свежие сверху", () => {
    const list = buildFamilies(rows());
    expect(list.map((f) => f.id)).toEqual(["f1", "f2", "f3"]);
    const kim = list[0]!;
    expect(kim.source).toBe("kiosk");
    expect(kim.book).toBe("ready");
    expect(kim.stories).toEqual({ total: 2, ready: 1, working: 1, failed: 0 });
    expect(kim.minutes).toBe(4);
    expect(kim.storytellers).toEqual([{ name: "Ким Анна", birthYear: 1940, consent: true }]);
    expect(list[1]!.book).toBe("none");
  });

  it("«Архив АКНЦ» — только archive_consent = true; источник фильтруется", () => {
    const list = buildFamilies(rows());
    expect(filterFamilies(list, "archive").map((f) => f.id)).toEqual(["f1", "f3"]);
    expect(filterFamilies(list, "kiosk").map((f) => f.id)).toEqual(["f1"]);
    expect(filterFamilies(list, "family").map((f) => f.id)).toEqual(["f2", "f3"]);
    expect(filterFamilies(buildFamilies(applyFilter(rows(), { hideDemo: true })), "archive").map((f) => f.id)).toEqual(["f1"]);
  });

  it("волонтёры: активные сверху, считаются сессии", () => {
    const v = buildVolunteers(rows(), since);
    expect(v.map((x) => [x.name, x.active, x.sessions, x.sessionsToday])).toEqual([
      ["Влад", true, 1, 1],
      ["Алия", false, 0, 0],
    ]);
  });
});
