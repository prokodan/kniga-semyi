import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FamilyEntity, Story } from "@/lib/types";
import { createEntityService, EntityError, type ChapterPatch, type ChapterText, type EntityRepo, type NewEntity } from "./service";

const FAM = "fam-1";

/** Хранилище в памяти без server-only: главы и записи словаря тестовой семьи. */
class TestRepo implements EntityRepo {
  rows = new Map<string, FamilyEntity>();
  stories = new Map<string, ChapterText & { family_id: string }>();
  saves: { id: string; patch: ChapterPatch }[] = [];
  private n = 0;

  async list(familyId: string) {
    return [...this.rows.values()].filter((r) => r.family_id === familyId).map((r) => ({ ...r }));
  }
  async insert(row: NewEntity) {
    if ([...this.rows.values()].some((r) => r.family_id === row.family_id && r.name_ru.toLowerCase() === row.name_ru.toLowerCase())) {
      throw new EntityError("conflict", "дубль");
    }
    const e = { ...row, id: `e${++this.n}`, updated_at: "2026-11-25T10:00:00Z" };
    this.rows.set(e.id, e);
    return { ...e };
  }
  async update(id: string, patch: Partial<NewEntity>) {
    const e = { ...this.rows.get(id)!, ...patch };
    this.rows.set(id, e);
    return { ...e };
  }
  async remove(id: string) {
    this.rows.delete(id);
  }
  async chapters(familyId: string) {
    return [...this.stories.values()].filter((s) => s.family_id === familyId).map((s) => {
      const c: Partial<typeof s> = { ...s };
      delete c.family_id;
      return c as ChapterText;
    });
  }
  async saveChapter(id: string, patch: ChapterPatch) {
    this.saves.push({ id, patch });
    const rest = { ...patch };
    delete rest.error;
    Object.assign(this.stories.get(id)!, rest);
  }
  chapter(id: string, c: Partial<ChapterText>, familyId = FAM) {
    this.stories.set(id, {
      id,
      family_id: familyId,
      status: "ready",
      title: null,
      quote: null,
      text_ru: null,
      title_ko: null,
      quote_ko: null,
      text_ko: null,
      ...c,
    });
  }
  entity(e: Partial<FamilyEntity> & Pick<FamilyEntity, "name_ru">): FamilyEntity {
    const row: FamilyEntity = {
      id: `e${++this.n}`,
      family_id: FAM,
      kind: "person",
      name_ko: null,
      description: null,
      story_ids: [],
      source: "auto",
      updated_at: "2026-11-25T09:00:00Z",
      ...e,
    };
    this.rows.set(row.id, row);
    return row;
  }
}

let repo: TestRepo;
let outdated: ReturnType<typeof vi.fn>;
let svc: ReturnType<typeof createEntityService>;

beforeEach(() => {
  repo = new TestRepo();
  outdated = vi.fn(async () => {});
  svc = createEntityService({ repo, markBookOutdated: outdated });
  repo.chapter("s1", {
    title: "Друг Вова",
    quote: "Вова сказал: держись.",
    text_ru: "С Вовой мы жили на одной улице. Вовка — так его звала мать. У Вовы был ЗИЛ.",
    title_ko: "친구 보바",
    quote_ko: "보바가 말했다.",
    text_ko: "보바와 나는 같은 거리에 살았다.",
  });
  repo.chapter("s2", { title: "Уштобе", text_ru: "Мы жили в Уштобе. Вова приезжал летом.", title_ko: "우슈토베", text_ko: "보바는 여름에 왔다." });
  repo.chapter("s3", { title: "Свадьба", text_ru: "Вовочка и Вован тут ни при чём.", text_ko: "결혼식" }); // только части других слов
  repo.chapter("s4", { status: "editing", text_ru: "Вова тоже был тут." }); // ещё собирается — не трогаем
  repo.chapter("x1", { text_ru: "Вова из другой семьи" }, "fam-2");
});

describe("словарь имён: правка записи", () => {
  it("RU: замена во всех главах (текст, заголовок, цитата), перевод — ровно для затронутых", async () => {
    const vova = repo.entity({ name_ru: "Вова", name_ko: "보바", story_ids: ["s1"] });
    const r = await svc.edit(FAM, vova.id, { name_ru: "Володя" });

    expect(r.retranslate).toEqual(["s1", "s2"]);
    expect(repo.stories.get("s1")).toEqual(
      expect.objectContaining({
        title: "Друг Володя",
        quote: "Володя сказал: держись.",
        text_ru: "С Володей мы жили на одной улице. Вовка — так его звала мать. У Володи был ЗИЛ.",
        // старый перевод снят — следующий шаг конвейера translate
        status: "translating",
        title_ko: null,
        text_ko: null,
      }),
    );
    expect(repo.stories.get("s2")!.text_ru).toBe("Мы жили в Уштобе. Володя приезжал летом.");
    expect(repo.stories.get("s3")!.text_ru).toBe("Вовочка и Вован тут ни при чём.");
    expect(repo.stories.get("s3")!.status).toBe("ready");
    expect(repo.stories.get("s4")!.text_ru).toBe("Вова тоже был тут.");
    expect(repo.stories.get("x1")!.text_ru).toBe("Вова из другой семьи");
    expect(repo.saves.map((s) => s.id)).toEqual(["s1", "s2"]);

    expect(r.entity).toEqual(expect.objectContaining({ name_ru: "Володя", source: "family", story_ids: ["s1", "s2"] }));
    expect(outdated).toHaveBeenCalledWith(FAM);
  });

  it("только KR: замена в корейском тексте без перевода", async () => {
    const vova = repo.entity({ name_ru: "Вова", name_ko: "보바" });
    const r = await svc.edit(FAM, vova.id, { name_ko: "보와" });
    expect(r.retranslate).toEqual([]);
    expect(r.koOnly).toEqual(["s1", "s2"]);
    expect(repo.stories.get("s1")).toEqual(expect.objectContaining({ title_ko: "친구 보와", quote_ko: "보와가 말했다.", status: "ready" }));
    expect(repo.stories.get("s1")!.text_ru).toContain("С Вовой");
    expect(r.koFix).toEqual({ from: "보바", to: "보와" });
  });

  it("только описание: главы не трогаем, книгу не помечаем, запись — family", async () => {
    const vova = repo.entity({ name_ru: "Вова", description: "сосед" });
    const r = await svc.edit(FAM, vova.id, { description: "друг детства, сосед по улице" });
    expect(repo.saves).toEqual([]);
    expect(outdated).not.toHaveBeenCalled();
    expect(r.entity).toEqual(expect.objectContaining({ description: "друг детства, сосед по улице", source: "family" }));
  });

  it("после перевода — поправка корейского написания", async () => {
    const vova = repo.entity({ name_ru: "Вова", name_ko: "보바" });
    const r = await svc.edit(FAM, vova.id, { name_ru: "Володя", name_ko: "볼로댜" });
    expect(r.koFix).toEqual({ from: "보바", to: "볼로댜" });
    // конвейер перевёл главу и снова написал «보바»
    Object.assign(repo.stories.get("s2")!, { status: "ready", text_ko: "보바는 여름에 왔다." });
    expect(await svc.fixKorean(FAM, "s2", r.koFix!)).toBe(true);
    expect(repo.stories.get("s2")!.text_ko).toBe("볼로댜는 여름에 왔다.");
  });

  it("имя другой записи — конфликт; чужая семья — не найдено", async () => {
    const vova = repo.entity({ name_ru: "Вова" });
    repo.entity({ name_ru: "Володя" });
    await expect(svc.edit(FAM, vova.id, { name_ru: "володя" })).rejects.toMatchObject({ code: "conflict" });
    await expect(svc.edit("fam-2", vova.id, { name_ru: "Вовик" })).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.edit(FAM, vova.id, { name_ru: "  " })).rejects.toMatchObject({ code: "bad_request" });
  });
});

describe("словарь имён: добавить и объединить", () => {
  it("добавить вручную: главы с упоминанием находятся сами", async () => {
    const r = await svc.add(FAM, { kind: "place", name_ru: "Уштобе", name_ko: "우슈토베", description: "посёлок, где жила семья" });
    expect(r.entity).toEqual(expect.objectContaining({ kind: "place", source: "family", story_ids: ["s2"] }));
    expect(repo.saves).toEqual([]);
    await expect(svc.add(FAM, { name_ru: "уштобе" })).rejects.toMatchObject({ code: "conflict" });
  });

  it("объединить «Вова» в «Володя»: замена в главах, одна запись, главы вместе", async () => {
    const vova = repo.entity({ name_ru: "Вова", name_ko: "보바", story_ids: ["s1"], description: "друг" });
    const volodya = repo.entity({ name_ru: "Володя", name_ko: "볼로댜", story_ids: ["s9"] });
    const r = await svc.merge(FAM, vova.id, volodya.id);

    expect(r.retranslate).toEqual(["s1", "s2"]);
    expect(repo.rows.has(vova.id)).toBe(false);
    expect(r.entity).toEqual(
      expect.objectContaining({ id: volodya.id, name_ru: "Володя", name_ko: "볼로댜", description: "друг", source: "family", story_ids: ["s9", "s1", "s2"] }),
    );
    expect(r.koFix).toEqual({ from: "보바", to: "볼로댜" });
    expect(repo.stories.get("s1")!.text_ru).toContain("С Володей");
  });

  it("список: люди → места → слова, по алфавиту", async () => {
    repo.entity({ name_ru: "кукси", kind: "word" });
    repo.entity({ name_ru: "Уштобе", kind: "place" });
    repo.entity({ name_ru: "Ерлан" });
    repo.entity({ name_ru: "Аня" });
    expect((await svc.list(FAM)).map((e) => e.name_ru)).toEqual(["Аня", "Ерлан", "Уштобе", "кукси"]);
  });
});

// Тип Story должен содержать поля ChapterText — иначе репозиторий Supabase отдаст не то.
const _check: ChapterText = {} as Pick<Story, keyof ChapterText>;
void _check;
