// #230: миграция языков в PGlite — умолчания = сегодняшний продукт, зеркало stories → story_texts.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const dir = path.join(process.cwd(), "supabase", "migrations");
let db: PGlite;

async function texts(storyId: string) {
  const { rows } = await db.query<{ lang: string; title: string | null; text: string | null; quote: string | null; origin: string; status: string }>(
    "select lang, title, text, quote, origin, status from story_texts where story_id = $1 order by lang",
    [storyId],
  );
  return rows;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec("create schema storage; create table storage.buckets(id text primary key, name text, public boolean);");
  await db.exec("create role service_role nologin;");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const at = files.findIndex((f) => f.includes("_languages_l0"));
  // До миграции языков — уже готовая глава (её должен подхватить перенос)
  for (const f of files.slice(0, at)) await db.exec(readFileSync(path.join(dir, f), "utf8"));
  await db.exec(`
    insert into families (id, name) values ('00000000-0000-0000-0000-000000000001', 'Ким');
    insert into storytellers (id, family_id, name) values ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Ким Чер Су');
    insert into stories (id, family_id, storyteller_id, text_ru, title, quote, text_ko, title_ko, quote_ko, status)
    values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002',
            'Старый текст', 'Старое название', 'Цитата', '옛 글', '옛 제목', '인용', 'ready');
  `);
  for (const f of files.slice(at)) await db.exec(readFileSync(path.join(dir, f), "utf8"));
}, 60_000);

describe("миграция языков L0 (#230)", () => {
  it("умолчания = сегодняшний продукт", async () => {
    const f = await db.query<{ book_langs: string[]; culture_packs: string[] }>("select book_langs, culture_packs from families");
    expect(f.rows[0]).toEqual({ book_langs: ["ru", "ko"], culture_packs: ["general", "koryo"] });
    const s = await db.query<{ spoken_langs: string[] }>("select spoken_langs from storytellers");
    expect(s.rows[0]!.spoken_langs).toEqual(["ru", "koryo"]);
  });

  it("готовые главы перенесены в story_texts (ru и ko)", async () => {
    expect(await texts("00000000-0000-0000-0000-00000000000a")).toEqual([
      { lang: "ko", title: "옛 제목", text: "옛 글", quote: "인용", origin: "ai", status: "ready" },
      { lang: "ru", title: "Старое название", text: "Старый текст", quote: "Цитата", origin: "ai", status: "ready" },
    ]);
  });

  it("зеркало: новая глава, правка, сброс шага (null) убирает строку языка", async () => {
    const id = "00000000-0000-0000-0000-00000000000b";
    await db.exec(`insert into stories (id, family_id, storyteller_id, status) values ('${id}', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'uploaded')`);
    expect(await texts(id)).toEqual([]);

    await db.exec(`update stories set text_ru = 'Глава', title = 'Название', quote = 'Ц' where id = '${id}'`);
    expect((await texts(id)).map((r) => [r.lang, r.text])).toEqual([["ru", "Глава"]]);

    await db.exec(`update stories set text_ko = '장', title_ko = '제목', quote_ko = '인' where id = '${id}'`);
    await db.exec(`update stories set text_ru = 'Глава после правки семьи' where id = '${id}'`);
    expect((await texts(id)).map((r) => [r.lang, r.title, r.text])).toEqual([
      ["ko", "제목", "장"],
      ["ru", "Название", "Глава после правки семьи"],
    ]);

    // правка семьи сбрасывает перевод (components/draft/save.ts) — строки ko больше нет, читаем колонки (null)
    await db.exec(`update stories set text_ko = null, title_ko = null, quote_ko = null where id = '${id}'`);
    expect((await texts(id)).map((r) => r.lang)).toEqual(["ru"]);

    // обновление других колонок строку не трогает
    await db.exec(`update stories set status = 'ready' where id = '${id}'`);
    expect((await texts(id)).map((r) => r.lang)).toEqual(["ru"]);
  });

  it("удаление главы удаляет её тексты; service_role имеет права", async () => {
    await db.exec(`delete from stories where id = '00000000-0000-0000-0000-00000000000a'`);
    expect(await texts("00000000-0000-0000-0000-00000000000a")).toEqual([]);
    const { rows } = await db.query<{ ok: boolean }>("select has_table_privilege('service_role', 'public.story_texts', 'select,insert,update,delete') as ok");
    expect(rows[0]!.ok).toBe(true);
  });

  it("повторный запуск миграции ничего не ломает (if not exists / on conflict)", async () => {
    const f = readdirSync(dir).find((x) => x.includes("_languages_l0"))!;
    await expect(db.exec(readFileSync(path.join(dir, f), "utf8"))).resolves.toBeTruthy();
  });
});

describe("#231: перевод на kk устаревает вместе с русским текстом", () => {
  it("правка text_ru удаляет строку kk от ИИ; ko (зеркало) и правку людей не трогает", async () => {
    const id = "00000000-0000-0000-0000-00000000000c";
    await db.exec(`insert into stories (id, family_id, storyteller_id, text_ru, title, text_ko, status)
                   values ('${id}', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'Глава', 'Т', '장', 'ready')`);
    await db.exec(`insert into story_texts (story_id, lang, title, text, quote) values ('${id}', 'kk', 'Т', 'Тарау', null)`);
    await db.exec(`update stories set status = 'ready', title = 'Т2' where id = '${id}'`);
    expect((await texts(id)).map((r) => r.lang)).toEqual(["kk", "ko", "ru"]);

    await db.exec(`update stories set text_ru = 'Глава после правки' where id = '${id}'`);
    expect((await texts(id)).map((r) => r.lang)).toEqual(["ko", "ru"]);

    await db.exec(`insert into story_texts (story_id, lang, title, text, quote, origin) values ('${id}', 'kk', 'Т', 'Тарау', null, 'proofread')`);
    await db.exec(`update stories set text_ru = 'Ещё правка' where id = '${id}'`);
    expect((await texts(id)).map((r) => [r.lang, r.origin])).toEqual([
      ["kk", "proofread"],
      ["ko", "ai"],
      ["ru", "ai"],
    ]);
  });
});
