// Ручки словаря имён (#104) без Supabase (память процесса, AI_MODE=mock): добавить → исправить →
// замена в главе → новый перевод главы через конвейер.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({})); // в тестах нет сборки Next с условием react-server
import { POST as createFamily } from "../../route";
import { GET as list, POST as add } from "./route";
import { PATCH as edit } from "./[id]/route";
import { POST as merge } from "./[id]/merge/route";
import { POST as translate } from "./translate/route";
import { changeResponse } from "./_lib";
import { MemoryInterviewRepo } from "@/lib/interview/repo";
import type { Story } from "@/lib/types";

const g = globalThis as { __interviewMemoryRepo?: MemoryInterviewRepo };

async function newFamily(book?: "ru,kk" | "ru") {
  const form = new FormData();
  form.set("name", "Книга семьи Ли");
  form.set("storytellerName", "Ли Николай");
  if (book) {
    // #233 анкета /start (флаги в тестах включены): казахская семья, языки книги
    form.append("packs", "kz");
    form.set("spoken", "ru");
    form.set("book", book);
  }
  const res = await createFamily(new Request("http://localhost/api/families", { method: "POST", body: form }));
  return (await res.json()) as { token: string; familyId: string; storytellerId: string };
}

function chapter(familyId: string, storytellerId: string, id: string, text_ru: string): Story {
  const now = new Date(Date.now() - 60 * 60_000).toISOString();
  const s = {
    id,
    family_id: familyId,
    storyteller_id: storytellerId,
    session_id: null,
    question_id: null,
    block: "childhood",
    parent_story_id: null,
    status: "ready",
    audio_url: null,
    duration_sec: 60,
    transcript: text_ru,
    text_ru,
    title: "Детство",
    quote: null,
    text_ko: "보바와 나는 친구였다.",
    title_ko: "어린 시절",
    quote_ko: null,
    facts: [],
    error: null,
    created_at: now,
    updated_at: now,
  } as unknown as Story;
  (g.__interviewMemoryRepo ??= new MemoryInterviewRepo()).stories.set(id, s);
  return s;
}

const req = (method: string, body?: unknown) =>
  new Request("http://localhost/api/families/t/entities", { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
const params = <T extends object>(p: T) => ({ params: Promise.resolve(p) });

describe("API словаря имён", () => {
  it("добавить, исправить: замена в главе и новый перевод только её", async () => {
    const f = await newFamily();
    const a = chapter(f.familyId, f.storytellerId, crypto.randomUUID(), "Мы с Вовой дружили. Вовочка — это его брат.");
    const b = chapter(f.familyId, f.storytellerId, crypto.randomUUID(), "Про другое.");

    const created = await add(req("POST", { kind: "person", name_ru: "Вова", name_ko: "보바", description: "друг" }), params({ token: f.token }));
    expect(created.status).toBe(201);
    const { entity } = (await created.json()) as { entity: { id: string; story_ids: string[] } };
    expect(entity.story_ids).toEqual([a.id]);

    const res = await edit(req("PATCH", { name_ru: "Володя" }), params({ token: f.token, id: entity.id }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { retranslate: string[]; bookOutdated: boolean; message: string };
    expect(body.retranslate).toEqual([a.id]);
    expect(body.bookOutdated).toBe(true);
    expect(body.message).toMatch(/Исправили в 1 главе/);

    const stories = g.__interviewMemoryRepo!.stories;
    expect(stories.get(a.id)).toEqual(expect.objectContaining({ text_ru: "Мы с Володей дружили. Вовочка — это его брат.", status: "translating", text_ko: null }));
    expect(stories.get(b.id)!.status).toBe("ready");

    // фоновый перевод (в тесте after() нет — вызываем ручку сами): глава снова готова, KR есть
    const tr = await translate(req("POST", { storyId: a.id, koFix: null }), params({ token: f.token }));
    expect(tr.status).toBe(200);
    expect(stories.get(a.id)).toEqual(expect.objectContaining({ status: "ready" }));
    expect(stories.get(a.id)!.text_ko).toBeTruthy();

    // чужая глава через перевод — нельзя
    const other = await translate(req("POST", { storyId: crypto.randomUUID() }), params({ token: f.token }));
    expect(other.status).toBe(404);

    const got = (await (await list(req("GET"), params({ token: f.token }))).json()) as { entities: { name_ru: string; source: string }[] };
    expect(got.entities).toEqual([expect.objectContaining({ name_ru: "Володя", source: "family" })]);
  });

  it("объединить; конфликт имени; неверный токен", async () => {
    const f = await newFamily();
    const one = (await (await add(req("POST", { name_ru: "Аня" }), params({ token: f.token }))).json()) as { entity: { id: string } };
    const two = (await (await add(req("POST", { name_ru: "Анна" }), params({ token: f.token }))).json()) as { entity: { id: string } };
    expect((await add(req("POST", { name_ru: "аня" }), params({ token: f.token }))).status).toBe(409);
    const m = await merge(req("POST", { into: two.entity.id }), params({ token: f.token, id: one.entity.id }));
    expect(m.status).toBe(200);
    const got = (await (await list(req("GET"), params({ token: f.token }))).json()) as { entities: { name_ru: string }[] };
    expect(got.entities.map((e) => e.name_ru)).toEqual(["Анна"]);
    expect((await list(req("GET"), params({ token: "0".repeat(64) }))).status).toBe(403);
  });

  it("#305 сообщение после правки — по языкам книги; RU + KR — строка байт в байт как раньше", async () => {
    const change = { entity: null, retranslate: ["a"], koOnly: [], koFix: null };
    const msg = async (langs: ("ru" | "ko" | "kk")[]) => ((await changeResponse(change, 200, langs).json()) as { message: string }).message;
    const before = "Исправили в 1 главе — корейский перевод обновится за пару минут. Книгу нужно пересобрать.";
    expect(((await changeResponse(change).json()) as { message: string }).message).toBe(before);
    expect(await msg(["ru", "ko"])).toBe(before);
    expect(await msg(["ru", "kk"])).toBe("Исправили в 1 главе — казахский перевод обновится за пару минут. Книгу нужно пересобрать.");
    expect(await msg(["ru"])).toBe("Исправили в 1 главе. Книгу нужно пересобрать.");
    const koOnly = { ...change, retranslate: [], koOnly: ["a", "b"] };
    expect(((await changeResponse(koOnly, 200, ["ru", "kk"]).json()) as { message: string }).message).toBe("Исправили в 2 главах. Книгу нужно пересобрать.");
  });

  it("#311 RU + KZ: казахское написание сохраняется, главы с именем — перевод kk заново, сообщение «казахский»", async () => {
    const f = await newFamily("ru,kk");
    const a = chapter(f.familyId, f.storytellerId, crypto.randomUUID(), "Мы с Ерланом дружили.");
    Object.assign(a, { text_ko: null, title_ko: null }); // у RU + KZ корейского нет
    const created = await add(req("POST", { kind: "person", name_ru: "Ерлан", name_kk: "Ерлан" }), params({ token: f.token }));
    expect(created.status).toBe(201);
    const { entity } = (await created.json()) as { entity: { id: string; name_kk?: string } };
    expect(entity.name_kk).toBe("Ерлан");

    const res = await edit(req("PATCH", { name_kk: "Ерлән" }), params({ token: f.token, id: entity.id }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { retranslate: string[]; message: string; entity: { name_kk?: string; source: string } };
    expect(body.retranslate).toEqual([a.id]);
    expect(body.message).toBe("Исправили в 1 главе — казахский перевод обновится за пару минут. Книгу нужно пересобрать.");
    expect(body.entity).toEqual(expect.objectContaining({ name_kk: "Ерлән", source: "family" }));
    expect(g.__interviewMemoryRepo!.stories.get(a.id)).toEqual(expect.objectContaining({ status: "translating", text_ru: "Мы с Ерланом дружили." }));
  });

  it("#305 только RU: после правки имени — без хвоста про перевод", async () => {
    const f = await newFamily("ru");
    const a = chapter(f.familyId, f.storytellerId, crypto.randomUUID(), "Мы с Вовой дружили.");
    Object.assign(a, { text_ko: null, title_ko: null });
    const { entity } = (await (await add(req("POST", { name_ru: "Вова" }), params({ token: f.token }))).json()) as { entity: { id: string } };
    const body = (await (await edit(req("PATCH", { name_ru: "Володя" }), params({ token: f.token, id: entity.id }))).json()) as { message: string };
    expect(body.message).toBe("Исправили в 1 главе. Книгу нужно пересобрать.");
  });
});
