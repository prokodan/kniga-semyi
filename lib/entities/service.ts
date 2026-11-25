// Словарь имён семьи (#104): правка, добавление, объединение записей и замена написания во всех главах.
// Без сервера и базы — хранилище и перевод передаются снаружи (index.ts), тесты подставляют свои.
import type { FamilyEntity, FamilyEntityKind, StoryStatus } from "@/lib/types";
import { mentionsRu, normName, replaceKo, replaceRu } from "./replace";

/** Глава семьи — то, что словарь читает и правит. Ответы на уточнения сюда не попадают. */
export interface ChapterText {
  id: string;
  status: StoryStatus;
  title: string | null;
  quote: string | null;
  text_ru: string | null;
  title_ko: string | null;
  quote_ko: string | null;
  text_ko: string | null;
}

export type ChapterPatch = Partial<Pick<ChapterText, "status" | "title" | "quote" | "text_ru" | "title_ko" | "quote_ko" | "text_ko">> & {
  error?: null;
};

export type NewEntity = Omit<FamilyEntity, "id" | "updated_at">;

export interface EntityRepo {
  list(familyId: string): Promise<FamilyEntity[]>;
  insert(row: NewEntity): Promise<FamilyEntity>;
  update(id: string, patch: Partial<NewEntity>): Promise<FamilyEntity>;
  remove(id: string): Promise<void>;
  /** Главы семьи (без ответов на уточнения и отказов) */
  chapters(familyId: string): Promise<ChapterText[]>;
  saveChapter(id: string, patch: ChapterPatch): Promise<void>;
}

export class EntityError extends Error {
  constructor(
    readonly code: "not_found" | "conflict" | "bad_request",
    message: string,
  ) {
    super(message);
    this.name = "EntityError";
  }
}

export interface EntityInput {
  kind?: FamilyEntityKind;
  name_ru?: string;
  name_ko?: string | null;
  description?: string | null;
}

/** Что изменилось: главы с новым русским текстом ждут перевода; koFix — поправить KR после перевода. */
export interface EntityChange {
  entity: FamilyEntity | null;
  /** Главы, где поменялся русский текст (заголовок, цитата, текст) — им нужен новый перевод */
  retranslate: string[];
  /** Главы, где поправили только корейское написание (без перевода) */
  koOnly: string[];
  koFix: { from: string; to: string } | null;
}

/** Главы, у которых ещё идёт расшифровка или редактура: их текст перезапишет конвейер, не трогаем. */
const BUSY: StoryStatus[] = ["uploaded", "transcribing", "editing", "skipped"];

const MAX = { name: 80, description: 200 };

function clean(s: string | null | undefined, max: number): string | null {
  const v = s == null ? "" : normName(s);
  if (v.length > max) throw new EntityError("bad_request", `Слишком длинно: до ${max} знаков`);
  return v || null;
}

export function chapterMentions(ch: ChapterText, name: string): boolean {
  return [ch.title, ch.quote, ch.text_ru].some((t) => mentionsRu(t, name));
}

export interface EntityServiceDeps {
  repo: EntityRepo;
  /** Отметить, что PDF книги устарел (книгу нужно пересобрать) */
  markBookOutdated(familyId: string): Promise<void>;
}

export function createEntityService({ repo, markBookOutdated }: EntityServiceDeps) {
  async function find(familyId: string, id: string): Promise<{ all: FamilyEntity[]; entity: FamilyEntity }> {
    const all = await repo.list(familyId);
    const entity = all.find((e) => e.id === id);
    if (!entity) throw new EntityError("not_found", "Такой записи в словаре нет — обновите страницу");
    return { all, entity };
  }

  function assertFree(all: FamilyEntity[], name: string, except: string[] = []) {
    const clash = all.find((e) => !except.includes(e.id) && e.name_ru.toLowerCase() === name.toLowerCase());
    if (clash) throw new EntityError("conflict", `«${clash.name_ru}» уже есть в словаре — объедините записи`);
  }

  /**
   * Заменить написание во всех главах: RU from → to (затем новый перевод), KR koFrom → koTo в главах,
   * где русский не менялся. Возвращает id глав для перевода и только-KR.
   */
  async function rewrite(
    familyId: string,
    ru: { from: string; to: string } | null,
    ko: { from: string; to: string } | null,
  ): Promise<{ retranslate: string[]; koOnly: string[]; mentioned: string[] }> {
    const retranslate: string[] = [];
    const koOnly: string[] = [];
    const mentioned: string[] = [];
    for (const ch of await repo.chapters(familyId)) {
      if (BUSY.includes(ch.status)) continue;
      const after = { title: ch.title, quote: ch.quote, text_ru: ch.text_ru };
      let changed = 0;
      if (ru) {
        for (const k of ["title", "quote", "text_ru"] as const) {
          const r = replaceRu(after[k], ru.from, ru.to);
          if (r.count > 0) {
            after[k] = r.text;
            changed += r.count;
          }
        }
      }
      if (changed > 0) {
        // Русский поменялся → старый перевод неверен: очищаем KR, следующий шаг по данным — translate (как в правке главы).
        await repo.saveChapter(ch.id, { ...after, title_ko: null, quote_ko: null, text_ko: null, status: "translating", error: null });
        retranslate.push(ch.id);
      } else if (ko) {
        const kr = { title_ko: ch.title_ko, quote_ko: ch.quote_ko, text_ko: ch.text_ko };
        let n = 0;
        for (const k of ["title_ko", "quote_ko", "text_ko"] as const) {
          const r = replaceKo(kr[k], ko.from, ko.to);
          if (r.count > 0) {
            kr[k] = r.text;
            n += r.count;
          }
        }
        if (n > 0) {
          await repo.saveChapter(ch.id, kr);
          koOnly.push(ch.id);
        }
      }
      if (ru && chapterMentions({ ...ch, ...after }, ru.to)) mentioned.push(ch.id);
    }
    if (retranslate.length + koOnly.length > 0) await markBookOutdated(familyId);
    return { retranslate, koOnly, mentioned };
  }

  return {
    /** Словарь семьи: группы по видам, внутри — по алфавиту. */
    async list(familyId: string): Promise<FamilyEntity[]> {
      const order: Record<FamilyEntityKind, number> = { person: 0, place: 1, word: 2 };
      return (await repo.list(familyId)).sort((a, b) => order[a.kind] - order[b.kind] || a.name_ru.localeCompare(b.name_ru, "ru"));
    },

    async chapters(familyId: string): Promise<ChapterText[]> {
      return repo.chapters(familyId);
    },

    /** Добавить вручную. Главы, где имя уже встречается, находятся сами. */
    async add(familyId: string, input: EntityInput): Promise<EntityChange> {
      const name_ru = clean(input.name_ru, MAX.name);
      if (!name_ru) throw new EntityError("bad_request", "Впишите, как это пишется по-русски");
      const all = await repo.list(familyId);
      assertFree(all, name_ru);
      const chapters = await repo.chapters(familyId);
      const entity = await repo.insert({
        family_id: familyId,
        kind: input.kind ?? "person",
        name_ru,
        name_ko: clean(input.name_ko, MAX.name),
        description: clean(input.description, MAX.description),
        story_ids: chapters.filter((c) => chapterMentions(c, name_ru)).map((c) => c.id),
        source: "family",
      });
      return { entity, retranslate: [], koOnly: [], koFix: null };
    },

    /**
     * Правка записи: новое написание RU — замена во всех главах и новый перевод этих глав;
     * новое KR — замена в корейском тексте (и после перевода). Запись становится source='family'.
     */
    async edit(familyId: string, id: string, input: EntityInput): Promise<EntityChange> {
      const { all, entity } = await find(familyId, id);
      const name_ru = input.name_ru === undefined ? entity.name_ru : clean(input.name_ru, MAX.name);
      if (!name_ru) throw new EntityError("bad_request", "Впишите, как это пишется по-русски");
      const name_ko = input.name_ko === undefined ? entity.name_ko : clean(input.name_ko, MAX.name);
      const description = input.description === undefined ? entity.description : clean(input.description, MAX.description);
      if (name_ru.toLowerCase() !== entity.name_ru.toLowerCase()) assertFree(all, name_ru, [id]);

      const ru = name_ru !== entity.name_ru ? { from: entity.name_ru, to: name_ru } : null;
      const ko = entity.name_ko && name_ko && entity.name_ko !== name_ko ? { from: entity.name_ko, to: name_ko } : null;
      const { retranslate, koOnly, mentioned } = await rewrite(familyId, ru, ko);

      const updated = await repo.update(id, {
        kind: input.kind ?? entity.kind,
        name_ru,
        name_ko,
        description,
        source: "family",
        story_ids: [...new Set([...entity.story_ids, ...mentioned])],
      });
      return { entity: updated, retranslate, koOnly, koFix: ko };
    },

    /** Объединить: from — лишняя запись («Вова»), into — остаётся («Володя»). */
    async merge(familyId: string, fromId: string, intoId: string): Promise<EntityChange> {
      if (fromId === intoId) throw new EntityError("bad_request", "Выберите другую запись");
      const { all, entity: from } = await find(familyId, fromId);
      const into = all.find((e) => e.id === intoId);
      if (!into) throw new EntityError("not_found", "Такой записи в словаре нет — обновите страницу");

      const ru = from.name_ru !== into.name_ru ? { from: from.name_ru, to: into.name_ru } : null;
      const koTo = into.name_ko ?? from.name_ko;
      const ko = from.name_ko && koTo && from.name_ko !== koTo ? { from: from.name_ko, to: koTo } : null;
      const { retranslate, koOnly, mentioned } = await rewrite(familyId, ru, ko);

      await repo.remove(from.id); // сначала удалить: уникальность имени не мешает, если «Вова» = «вова»
      const entity = await repo.update(into.id, {
        name_ko: koTo,
        description: into.description ?? from.description,
        source: "family",
        story_ids: [...new Set([...into.story_ids, ...from.story_ids, ...mentioned])],
      });
      return { entity, retranslate, koOnly, koFix: ko };
    },

    /**
     * После перевода главы поправить корейское написание (переводчик мог снова написать старое).
     * Вызывается для каждой главы из retranslate, когда её перевод готов.
     */
    async fixKorean(familyId: string, storyId: string, koFix: { from: string; to: string }): Promise<boolean> {
      const ch = (await repo.chapters(familyId)).find((c) => c.id === storyId);
      if (!ch) return false;
      const kr = { title_ko: ch.title_ko, quote_ko: ch.quote_ko, text_ko: ch.text_ko };
      let n = 0;
      for (const k of ["title_ko", "quote_ko", "text_ko"] as const) {
        const r = replaceKo(kr[k], koFix.from, koFix.to);
        if (r.count > 0) {
          kr[k] = r.text;
          n += r.count;
        }
      }
      if (n > 0) await repo.saveChapter(storyId, kr);
      return n > 0;
    },
  };
}

export type EntityService = ReturnType<typeof createEntityService>;
