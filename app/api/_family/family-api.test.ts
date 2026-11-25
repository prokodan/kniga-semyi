// Ручки семьи без Supabase (память процесса): создать → ссылка → загрузка → согласие → история.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({})); // в тестах нет сборки Next с условием react-server
import { POST as createFamily } from "../families/route";
import { POST as uploadUrl } from "../upload-url/route";
import { POST as consent } from "../consent/route";
import { POST as stories } from "../stories/route";

function json(body: unknown, token?: string) {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { "x-family-token": token } : {}) },
    body: JSON.stringify(body),
  });
}

async function newFamily() {
  const form = new FormData();
  form.set("name", "Книга семьи Пак");
  form.set("storytellerName", "Дедушка Николай");
  form.set("birthYear", "1938");
  form.set("photo", new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" }), "photo.jpg");
  const res = await createFamily(new Request("http://localhost/api/families", { method: "POST", body: form }));
  expect(res.status).toBe(201);
  return (await res.json()) as { token: string; storytellerId: string; url: string };
}

describe("API семьи", () => {
  it("создаёт книгу и отдаёт ссылку /f/<token>", async () => {
    const f = await newFamily();
    expect(f.url).toBe(`/f/${f.token}`);
  });

  it("проверяет поля формы", async () => {
    const form = new FormData();
    form.set("name", "");
    form.set("storytellerName", "Мария");
    form.set("birthYear", "1800");
    const res = await createFamily(new Request("http://localhost/api/families", { method: "POST", body: form }));
    expect(res.status).toBe(400);
  });

  it("неверный токен → 403 с понятным текстом", async () => {
    const res = await uploadUrl(json({ storytellerId: "x", kind: "story", mime: "audio/mp4" }, "0".repeat(64)));
    expect(res.status).toBe(403);
    expect((await res.json()).message).toMatch(/Ссылка/);
  });

  it("без согласия история не создаётся (409), после согласия — uploaded", async () => {
    const f = await newFamily();
    const up = await (await uploadUrl(json({ storytellerId: f.storytellerId, kind: "story", mime: "audio/mp4" }, f.token))).json();
    expect(up.signedUrl).toBeNull(); // без Storage — загрузку пропускаем
    const body = { storytellerId: f.storytellerId, path: up.path, questionId: "roots-01", block: "roots", durationSec: 61.2 };

    const early = await stories(json(body, f.token));
    expect(early.status).toBe(409);
    expect((await early.json()).error).toBe("consent_required");

    const c = await (await uploadUrl(json({ storytellerId: f.storytellerId, kind: "consent", mime: "audio/webm;codecs=opus" }, f.token))).json();
    // путь истории вместо пути согласия не принимается
    expect((await consent(json({ storytellerId: f.storytellerId, path: up.path }, f.token))).status).toBe(400);
    expect((await consent(json({ storytellerId: f.storytellerId, path: c.path }, f.token))).status).toBe(200);

    const res = await stories(json(body, f.token));
    expect(res.status).toBe(201);
    expect((await res.json()).status).toBe("uploaded");
  });

  it("чужой путь и чужой рассказчик отклоняются", async () => {
    const a = await newFamily();
    const b = await newFamily();
    const upB = await (await uploadUrl(json({ storytellerId: b.storytellerId, kind: "story", mime: "audio/mp4" }, b.token))).json();
    expect((await uploadUrl(json({ storytellerId: b.storytellerId, kind: "story", mime: "audio/mp4" }, a.token))).status).toBe(403);
    expect((await stories(json({ storytellerId: a.storytellerId, path: upB.path }, a.token))).status).toBeGreaterThanOrEqual(400);
  });
});
