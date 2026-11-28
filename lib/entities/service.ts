// Словарь имён семьи (#104): правка, добавление, объединение записей и замена написания во всех главах.
// Без сервера и базы — хранилище и перевод передаются снаружи (index.ts), тесты подставляют свои.
// #311: у книги RU + KZ (опция `kk`) — ещё казахское написание name_kk: правка семьи → перевод kk этих глав заново.
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

/** Запись словаря; name_kk — #298 (миграция 20261128140000), в lib/types пока нет — до правки контракта Z6. */
export type EntityRow = FamilyEntity & { name_kk?: string | null };

export type NewEntity = Omit<EntityRow, "id" | "updated_at">;

export interface EntityRepo {
  list(familyId: string): Promise<EntityRow[]>;
  insert(row: NewEntity): Promise<EntityRow>;
  update(id: string, patch: Partial<NewEntity>): Promise<EntityRow>;
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
  /** #311: казахское написание — только у книги RU + KZ (опция kk), иначе не читается и не пишется */
  name_kk?: string | null;
  description?: string | null;
}

/** #311: книга семьи с казахским (RU + KZ, флаг lang_kk) — правится и name_kk. Без опции — как до #311. */
export interface EntityOptions {
  kk?: boolean;
}

/** Что изменилось: главы с новым русским текстом ждут перевода; koFix — поправить KR после перевода. */
export interface EntityChange {
  entity: EntityRow | null;
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

/**
 * #138: у слов корё мар корейское написание — обычное слово (аппади → 아버지, кукси → 국수). Замена по всем главам
 * задела бы и «другого» отца, и цитаты. Поэтому у слов правка KR меняет только словарь: новое написание берёт
 * перевод следующих глав (namesForTranslate), уже готовые корейские тексты не трогаем.
 */
export const KO_REWRITE_KINDS: readonly FamilyEntityKind[] = ["person", "place"];

export function chapterMentions(ch: ChapterText, name: string): boolean {
  return [ch.title, ch.quote, ch.text_ru].some((t) => mentionsRu(t, name));
}

export interface EntityServiceDeps {
  repo: EntityRepo;
  /** Отметить, что PDF книги устарел (книгу нужно пересобрать) */
  markBookOutdated(familyId: string): Promise<void>;
  /**
   * #311: удалить переводы главы без колонок (kk, origin ai) — их сделает заново шаг translate. Нужна только книге
   * с kk: триггер stories_stale_translations ловит лишь новый text_ru, а словарь меняет и заголовок / цитату.
   */
  dropTranslations?(storyId: string): Promise<void>;
}

export function createEntityService({ repo, markBookOutdated, dropTranslations }: EntityServiceDeps) {
  async function find(familyId: string, id: string): Promise<{ all: EntityRow[]; entity: EntityRow }> {
    const all = await repo.list(familyId);
    const entity = all.find((e) => e.id === id);
    if (!entity) throw new EntityError("not_found", "Такой записи в словаре нет — обновите страницу");
    return { all, entity };
  }

  function assertFree(all: EntityRow[], name: string, except: string[] = []) {
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

  /** #311: переводы kk этих глав устарели — удалить (переведёт заново шаг translate). Сбой — не страшно. */
  async function dropKk(ids: readonly string[]) {
    if (!dropTranslations) return;
    for (const id of ids) {
      try {
        await dropTranslations(id);
      } catch (e) {
        console.warn(`[entities] перевод kk ${id.slice(0, 8)}:`, (e as Error).message);
      }
    }
  }

  /**
   * #311: семья поправила казахское написание человека / места → главы с этим именем (кроме уже ушедших на перевод)
   * переводим на казахский заново: старый перевод удаляем, глава ждёт шага translate (вход — словарь, правка семьи первая).
   */
  async function redoKk(familyId: string, nameRu: string, skip: readonly string[]): Promise<string[]> {
    const ids: string[] = [];
    for (const ch of await repo.chapters(familyId)) {
      if (BUSY.includes(ch.status) || skip.includes(ch.id) || !ch.text_ru || !chapterMentions(ch, nameRu)) continue;
      ids.push(ch.id);
    }
    await dropKk(ids);
    for (const id of ids) await repo.saveChapter(id, { status: "translating", error: null });
    if (ids.length > 0) await markBookOutdated(familyId);
    return ids;
  }

  return {
    /** Словарь семьи: группы по видам, внутри — по алфавиту. */
    async list(familyId: string): Promise<EntityRow[]> {
      const order: Record<FamilyEntityKind, number> = { person: 0, place: 1, word: 2 };
      return (await repo.list(familyId)).sort((a, b) => order[a.kind] - order[b.kind] || a.name_ru.localeCompare(b.name_ru, "ru"));
    },

    async chapters(familyId: string): Promise<ChapterText[]> {
      return repo.chapters(familyId);
    },

    /** Добавить вручную. Главы, где имя уже встречается, находятся сами. */
    async add(familyId: string, input: EntityInput, opts: EntityOptions = {}): Promise<EntityChange> {
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
        ...(opts.kk && input.name_kk !== undefined ? { name_kk: clean(input.name_kk, MAX.name) } : {}),
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
    async edit(familyId: string, id: string, input: EntityInput, opts: EntityOptions = {}): Promise<EntityChange> {
      const { all, entity } = await find(familyId, id);
      const name_ru = input.name_ru === undefined ? entity.name_ru : clean(input.name_ru, MAX.name);
      if (!name_ru) throw new EntityError("bad_request", "Впишите, как это пишется по-русски");
      const name_ko = input.name_ko === undefined ? entity.name_ko : clean(input.name_ko, MAX.name);
      const description = input.description === undefined ? entity.description : clean(input.description, MAX.description);
      if (name_ru.toLowerCase() !== entity.name_ru.toLowerCase()) assertFree(all, name_ru, [id]);

      const ru = name_ru !== entity.name_ru ? { from: entity.name_ru, to: name_ru } : null;
      const koText = KO_REWRITE_KINDS.includes(input.kind ?? entity.kind) && KO_REWRITE_KINDS.includes(entity.kind);
      const ko = koText && entity.name_ko && name_ko && entity.name_ko !== name_ko ? { from: entity.name_ko, to: name_ko } : null;
      const { retranslate, koOnly, mentioned } = await rewrite(familyId, ru, ko);

      // #311: книга RU + KZ — казахское написание (только люди и места: их берёт вход перевода kk)
      const kkPatch: Partial<NewEntity> = {};
      if (opts.kk) {
        await dropKk(retranslate);
        const name_kk = input.name_kk === undefined ? (entity.name_kk ?? null) : clean(input.name_kk, MAX.name);
        if (input.name_kk !== undefined) kkPatch.name_kk = name_kk;
        if (name_kk && name_kk !== (entity.name_kk ?? null) && KO_REWRITE_KINDS.includes(input.kind ?? entity.kind)) {
          retranslate.push(...(await redoKk(familyId, name_ru, retranslate)));
        }
      }

      const updated = await repo.update(id, {
        kind: input.kind ?? entity.kind,
        name_ru,
        name_ko,
        ...kkPatch,
        description,
        source: "family",
        story_ids: [...new Set([...entity.story_ids, ...mentioned])],
      });
      return { entity: updated, retranslate, koOnly, koFix: ko };
    },

    /** Объединить: from — лишняя запись («Вова»), into — остаётся («Володя»). */
    async merge(familyId: string, fromId: string, intoId: string, opts: EntityOptions = {}): Promise<EntityChange> {
      if (fromId === intoId) throw new EntityError("bad_request", "Выберите другую запись");
      const { all, entity: from } = await find(familyId, fromId);
      const into = all.find((e) => e.id === intoId);
      if (!into) throw new EntityError("not_found", "Такой записи в словаре нет — обновите страницу");

      const ru = from.name_ru !== into.name_ru ? { from: from.name_ru, to: into.name_ru } : null;
      const koTo = into.name_ko ?? from.name_ko;
      const koText = KO_REWRITE_KINDS.includes(from.kind) && KO_REWRITE_KINDS.includes(into.kind);
      const ko = koText && from.name_ko && koTo && from.name_ko !== koTo ? { from: from.name_ko, to: koTo } : null;
      const { retranslate, koOnly, mentioned } = await rewrite(familyId, ru, ko);
      if (opts.kk) await dropKk(retranslate); // #311: перевод kk этих глав — заново

      await repo.remove(from.id); // сначала удалить: уникальность имени не мешает, если «Вова» = «вова»
      const entity = await repo.update(into.id, {
        name_ko: koTo,
        ...(opts.kk ? { name_kk: into.name_kk ?? from.name_kk ?? null } : {}),
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
