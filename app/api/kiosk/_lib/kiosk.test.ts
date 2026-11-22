import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { MemoryFamilyStore } from "@/lib/db/access";
import { MemoryInterviewRepo } from "@/lib/interview/repo";
import { kioskDayEnd, kioskDayStart, kioskPinMatches, makeKioskToken, verifyKioskToken } from "./pin";
import { buildQueue, countStories, MemoryKioskStore } from "./store";

describe("PIN киоска", () => {
  it("сверяет PIN на сервере; без KIOSK_PIN вход закрыт", () => {
    expect(kioskPinMatches("2611", "2611")).toBe(true);
    expect(kioskPinMatches("2611", " 2611 ")).toBe(true);
    expect(kioskPinMatches("2611", "2612")).toBe(false);
    expect(kioskPinMatches("2611", "26110")).toBe(false);
    expect(kioskPinMatches(undefined, "")).toBe(false);
  });

  it("cookie живёт до полуночи по Алматы и подписана PIN-ом", () => {
    const now = new Date("2026-11-23T10:00:00Z"); // 15:00 в Алматы
    const token = makeKioskToken("2611", now);
    expect(verifyKioskToken("2611", token, now)).toBe(true);
    expect(verifyKioskToken("9999", token, now)).toBe(false); // сменили PIN — все планшеты вышли
    expect(verifyKioskToken("2611", token, new Date("2026-11-23T18:59:59Z"))).toBe(true); // 23:59:59 Алматы
    expect(verifyKioskToken("2611", token, new Date("2026-11-23T19:00:00Z"))).toBe(false); // полночь
    expect(verifyKioskToken("2611", `${Date.now() + 1e9}.подделка`, now)).toBe(false);
    expect(verifyKioskToken("2611", undefined, now)).toBe(false);
  });

  it("день киоска — по Алматы (UTC+5)", () => {
    expect(kioskDayStart(new Date("2026-11-23T20:30:00Z")).toISOString()).toBe("2026-11-23T19:00:00.000Z"); // уже 24.11 в Алматы
    expect(kioskDayStart(new Date("2026-11-23T18:30:00Z")).toISOString()).toBe("2026-11-22T19:00:00.000Z");
    expect(kioskDayEnd(new Date("2026-11-23T10:00:00Z")).toISOString()).toBe("2026-11-23T19:00:00.000Z");
  });
});

describe("карточка и очередь киоска (память)", () => {
  function setup() {
    const repo = new MemoryInterviewRepo();
    const families = new MemoryFamilyStore(repo.stories);
    return { repo, families, kiosk: new MemoryKioskStore(families, repo) };
  }
  const elder = { name: "Ким Мария", name_ko: null, birth_year: 1941, birth_place: "Уштобе", photo: null };

  it("создаёт семью с source = 'kiosk' и рассказчика, архив — выключен по умолчанию", async () => {
    const { kiosk, repo } = setup();
    const { family, storyteller } = await kiosk.createElder(elder);
    expect(family.source).toBe("kiosk");
    expect(family.archive_consent).toBe(false);
    expect(family.name).toContain("Ким Мария");
    expect(storyteller.family_id).toBe(family.id);
    expect(repo.families.get(family.id)?.storytellers.has(storyteller.id)).toBe(true); // интервью-агент знает семью
    const view = await kiosk.getElder(family.id);
    expect(view?.storyteller?.id).toBe(storyteller.id);
  });

  it("не открывает семьи, созданные не в киоске", async () => {
    const { kiosk, families } = setup();
    const { family } = await families.createFamily({ name: "Семья", gift_date: null, contact: null, storyteller: { ...elder, name: "Дед" }, photo: null });
    expect(await kiosk.getElder(family.id)).toBeNull();
    expect(await kiosk.setArchiveConsent(family.id, true)).toBe(false);
  });

  it("галочка архива АКНЦ пишет archive_consent", async () => {
    const { kiosk } = setup();
    const { family } = await kiosk.createElder(elder);
    expect(await kiosk.setArchiveConsent(family.id, true)).toBe(true);
    expect((await kiosk.getElder(family.id))?.family.archive_consent).toBe(true);
  });

  it("волонтёры: новый по имени не дублируется", async () => {
    const { kiosk } = setup();
    const a = await kiosk.addVolunteer("Анна");
    const b = await kiosk.addVolunteer("анна");
    expect(b.id).toBe(a.id);
    expect((await kiosk.listVolunteers()).map((v) => v.name)).toEqual(["Анна"]);
    expect(await kiosk.getVolunteer("нет-такого")).toBeNull();
  });

  it("очередь дня: старейшины за сегодня с волонтёром и статусами", async () => {
    const { kiosk, repo, families } = setup();
    const vol = await kiosk.addVolunteer("Анна");
    const { family, storyteller } = await kiosk.createElder(elder);
    await families.saveConsent(storyteller.id, `${family.id}/${storyteller.id}/consent-x.webm`);
    await repo.createSession({ family_id: family.id, storyteller_id: storyteller.id, mode: "kiosk", volunteer_id: vol.id, state: {} as never });
    const s = await families.createStory(family.id, {
      storyteller_id: storyteller.id,
      audio_path: "p",
      question_id: "roots-01",
      block: "roots",
      duration_sec: 30,
      session_id: null,
      parent_story_id: null,
    });
    families.stories.get(s.id)!.status = "ready";

    const q = await kiosk.queue(new Date(Date.now() - 60_000));
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ familyId: family.id, name: "Ким Мария", consent: true, archive: false, volunteer: "Анна" });
    expect(q[0]!.stories).toEqual({ total: 1, ready: 1, working: 0, failed: 0 });
    expect(await kiosk.queue(new Date(Date.now() + 60_000))).toHaveLength(0); // вчерашних не показываем
  });
});

describe("сводка очереди", () => {
  it("ответы на уточнения не считаются отдельными рассказами", () => {
    expect(
      countStories([
        { family_id: "f", status: "ready", parent_story_id: null },
        { family_id: "f", status: "transcribing", parent_story_id: null },
        { family_id: "f", status: "failed", parent_story_id: null },
        { family_id: "f", status: "ready", parent_story_id: "x" },
      ]),
    ).toEqual({ total: 3, ready: 1, working: 1, failed: 1 });
  });

  it("свежая сессия поднимает старейшину наверх", () => {
    const st = (id: string, family_id: string) => ({ id, family_id, name: id, birth_year: null, photo_url: null, consent_at: null, created_at: "2026-11-23T05:00:00Z" });
    const q = buildQueue({
      families: [
        { id: "a", archive_consent: false, created_at: "2026-11-23T05:00:00Z" },
        { id: "b", archive_consent: true, created_at: "2026-11-23T06:00:00Z" },
      ],
      storytellers: [st("A", "a"), st("B", "b")],
      stories: [],
      sessions: [{ family_id: "a", volunteer_id: null, started_at: "2026-11-23T07:00:00Z" }],
      volunteers: [],
    });
    expect(q.map((x) => x.familyId)).toEqual(["a", "b"]);
    expect(q[1]!.archive).toBe(true);
  });
});
